
const semver = require('semver');
const chalk = require('chalk');
const _ = require('lodash');

const { Which, mergeBranch, compareBranches, requestFromAllPages } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');
const utils = require('../utils');

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red(reason.stack || reason));
});

const VERSION_BRANCH_RE = /^v\d+\.\d+(\.\d+)?(?:-release)?$/i;
const DEFAULT_BRANCHES = ['master', 'dev', 'develop'];  // 开发分支，如果有多个分支并存，从前往后合并
function syncable (branch) {
    let name = branch.name;
    let match = VERSION_BRANCH_RE.exec(name);
    if (match) {
        branch.semver = semver.coerce(name);
        let patch = match[1];
        if (!patch) {
            // v*.* 分支，被解析成了 v*.*.0，实际上应该是 v*.*.9999
            branch.semver.patch = Number.MAX_SAFE_INTEGER;
        }
        return true;
    }
    return DEFAULT_BRANCHES.includes(name);
}

function sortBranches (branches) {
    branches.sort((lhs, rhs) => {
        let lhsDefaultIndex = DEFAULT_BRANCHES.indexOf(lhs.name);
        let rhsDefaultIndex = DEFAULT_BRANCHES.indexOf(rhs.name);
        if (lhsDefaultIndex !== -1 || rhsDefaultIndex !== -1) {
            return lhsDefaultIndex - rhsDefaultIndex;
        }

        if (semver.gt(lhs.semver, rhs.semver)) {
            return 1;
        }
        else if (semver.lt(lhs.semver, rhs.semver)) {
            return -1;
        }
        else if (rhs.name.endsWith('-release')) {
            return 1;
        }
        else {
            return -1;
        }
    });
    return branches;
}

async function queryBranches (which) {
    const endTimer = utils.timer(`query branches of ${which}`);

    let query = `
query branches ($owner: String!, $repo: String!, PageVarDef) {
  repository(owner: $owner, name: $repo) {
    refs(refPrefix: "refs/heads/", direction: DESC, PageVar) {
      nodes {
        name
        target {
          oid
        }
      }
      PageRes
    }
  }
}`;
    let variables = {
        owner: which.owner,
        repo: which.repo,
    };
    let res = await requestFromAllPages(query, variables, res => {
        let repository = res.repository;
        if (!repository) {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        return repository.refs;
    });

    res = res.filter(syncable);

    endTimer();
    return res;
}

async function wasMergedToAny (which, newBranches, oldBranch) {
    for (let newBranch of newBranches) {
        // console.log(`    comparing '${which.repo}/${oldBranch}' with '${newBranch}'...`);
        let status = await compareBranches(which, newBranch, oldBranch);
        if (status === 'behind') {
            return newBranch;
        }
    }
    return null;
}

async function syncBranch (which, branches) {
    if (!branches) {
        branches = await queryBranches(which);
        sortBranches(branches);
        branches = branches.map(x => x.name);
    }

    const endTimer = utils.timer(`synchronize branches of ${which}`);
    console.log(`    (${branches.join(' -> ')})`);

    for (let i = 0; i < branches.length - 1; i++) {
        let oldBranch = branches[i];
        let newBranch = branches[i + 1];

        // try to merge directly
        const res = await mergeBranch(which, newBranch, oldBranch);
        if (res === mergeBranch.Merged) {
            console.log(`    merged on '${which.repo}', '${oldBranch}' -> '${newBranch}'`);
        }
        else if (res === mergeBranch.Conflict) {
            // checks if merged to newer branches
            let newBranches = branches.slice(i + 2);
            let mergedTo = await wasMergedToAny(which, newBranches, oldBranch);
            if (mergedTo) {
                console.log(`    '${which.repo}/${oldBranch}' has previously been merged into '${mergedTo}', cancel merge to '${newBranch}'.`);
            }
            else {
                console.warn(`    Can’t automatically merge branches of '${which.repo}', from '${oldBranch}' into '${newBranch}'.`);
                return {
                    which,
                    oldBranch,
                    newBranch,
                };
            }
        }
    }

    endTimer();
    return null;
}

(async function () {

    // get dependencies repo branch of Fireball

    let fireball = getFireball(null);
    let branches = await queryBranches(fireball);
    sortBranches(branches);
    branches = branches.map(x => x.name);
    let branchesToParseDep = branches.slice(-3);
    let endTimer = utils.timer(`query repos of ${branchesToParseDep} in ${fireball}`);
    let packages = await Promise.all(branchesToParseDep.map(x => {
        let which = new Which(fireball.owner, fireball.repo, x);
        return getMainPackage(which);
    }));
    let repos = packages.map(x => parseDependRepos(JSON.parse(x)));
    repos = _.uniqBy(_.flatten(repos), x => {
        x.branch = null;    // just compare repos, ignore the differences in those branches
        return String(x);
    });
    endTimer();

    // sync

    endTimer = utils.timer(`synchronize repos`);
    let promises = [syncBranch(fireball, branches)];
    promises = promises.concat(repos.map(x => syncBranch(x)));
    let status = await Promise.all(promises);
    endTimer();

    // output

    status = status.filter(Boolean);
    if (status.length > 0) {
        console.error(chalk.red(`There are merge conflicts, please manually merge these branches:`));
        for (let info of status) {
            console.error(`  Repo: ${chalk.red(info.which)}, from: ${chalk.red(info.oldBranch)}, to: ${chalk.red(info.newBranch)}`);
        }
        process.exit(1);
    }
})();
