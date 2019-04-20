
const chalk = require('chalk');
const _ = require('lodash');
const semver = require('semver');

require('../global-init');
const utils = require('../utils');
const { Which, requestFromAllPages } = require('./github');
const { getFireball, getMainPackage, queryDependReposFromAllBranches, queryBranchesSortedByTime, parseDependRepos, MarkdownToHTML, fillBranchInfo } = require('./utils');

const { DataToMarkdown } = require('./list-pr-output');
const server = require('./http-server');

const settings = utils.getSettings();


const DONT_MERGE_RE = /\bWIP\b|\bDo(?:n'?t| not)\s*Merge\b/i;
function canMerge (node) {
    if (DONT_MERGE_RE.test(node.title)) {
        console.log(`    skip PR "${node.title}"`);
        return false;
    }
    let skipLabelIndex = node.labels.nodes.findIndex(x => DONT_MERGE_RE.test(x.name));
    if (skipLabelIndex !== -1) {
        console.log(`    skip PR "${node.title}" (label: "${node.labels.nodes[skipLabelIndex].name}")`);
        return false;
    }
    return true;
}

async function queryPepo (which, baseBranches, output) {
    const endTimer = utils.timer(`query pull requests of ${which}`);

    let query = `query pr ($owner: String!, $repo: String!, PageVarDef) {
  repository(owner: $owner, name: $repo) {
    pullRequests (states: OPEN, orderBy: {
      direction: ASC,
      field: CREATED_AT
    }, PageVar) {
      nodes {
        title
        baseRefName
        labels (first: 10) {
          nodes {
            name
          }
        }
        url
        bodyHTML
        author {
          login
        }
        updatedAt
      }
      PageRes
    }
  }
}`;
    let variables = {
        owner: which.owner,
        repo: which.repo,
    };
    let prs = await requestFromAllPages(query, variables, res => {
        let repository = res.repository;
        if (!repository) {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        return repository.pullRequests;
    });
    prs = _(prs)
        .filter(canMerge)
        .filter(x => {
            if (baseBranches) {
                if (Array.isArray(baseBranches)) {
                    return baseBranches.includes(x.baseRefName)
                }
                else {
                    // semver
                    let branch = fillBranchInfo(x.baseRefName);
                    return semver.satisfies(branch.semver, baseBranches);
                }
            }
            else {
                return true;
            }
        })
        .sortBy('baseRefName')
        .value();

    prs.forEach(x => {
        let author = x.author;
        author.name = settings.usernames[author.login] || author.login;
    });

    if (prs.length > 0) {
        output.write({ repo: which, prs });
    }

    endTimer();
}

//

async function gatherData (toHTML) {

    // init

    const args = process.argv.slice(2);
    let baseBranches, currentBranch, repos, info;
    if (args.length > 0) {
        let currentBranch;
        if (args[0] === '-s') {
            // semver
            let baseBranchSemver = args[1];
            if (!baseBranchSemver) {
                throw 'Missing semver';
            }

            baseBranches = (await queryBranchesSortedByTime(getFireball()))
                .filter(x => semver.satisfies(x.semver, baseBranchSemver));
            baseBranches = baseBranches.map(x => x.name);
            currentBranch = baseBranches[baseBranches.length - 1];
        }
        else {
            // bransh list
            baseBranches = args;
            currentBranch = baseBranches[baseBranches.length - 1];
        }
        info = `Review pull requests for branches [${baseBranches}].\nResolve dependent repos from ${currentBranch}.`;

        let fireball = getFireball(currentBranch);
        let packageContent = await getMainPackage(fireball);
        let packageJson = JSON.parse(packageContent);
        repos = parseDependRepos(packageJson);
    }
    else {
        // all branch
        let res = await queryDependReposFromAllBranches();
        repos = res.repos;
        info = `Review all pull requests.\nResolve dependent repos from [${res.branchesToParseDep}].`;
    }

    console.log(info);
    let output = new DataToMarkdown(info);
    output.pipe(toHTML);

    // parse repos

    const timerName = `Finished list pull requests`;
    console.time(timerName);

    // let promises = [queryPepo(fireball, baseBranches, output), queryPepo(new Which('cocos-creator', 'engine', null), baseBranches, output)];
    let promises = [queryPepo(getFireball(), baseBranches, output)];
    promises = promises.concat(repos.map(x => queryPepo(x, baseBranches, output)));
    await Promise.all(promises);

    output.end();
    console.timeEnd(timerName);
}

async function deferredInit (toHTML) {
    await utils.sleep();
    server.launch();
    await utils.sleep();
    server.send(toHTML);
    await utils.sleep();
    server.openBrowser();
}

(async function () {
    let toHTML = new MarkdownToHTML();
    await Promise.all([
        gatherData(toHTML),
        deferredInit(toHTML),
    ]);
})();
