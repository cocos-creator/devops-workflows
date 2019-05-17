
const semver = require('semver');
const chalk = require('chalk');
const _ = require('lodash');

const { Which, mergeBranch, queryBranches, hasBeenMergedTo, updateBranch } = require('./github');
const { getFireball, queryDependReposFromAllBranches, sortBranchesByVersion, fillBranchInfo } = require('./utils');
require('../global-init');
const utils = require('../utils');
const settings = utils.getSettings();

let syncRepos = process.argv.length > 2 ? process.argv.slice(2) : null;

async function syncBranch (which, branches) {
    if (!branches) {
        branches = await queryBranches(which);
        branches.forEach(fillBranchInfo);
        branches = branches.filter(x => x.isMainChannel);
    }
    sortBranchesByVersion(branches);

    const endTimer = utils.timer(`synchronize branches of ${which}`);
    console.log(`    (${branches.map(x => x.name).join(' -> ')})`);

    for (let i = 0; i < branches.length - 1; i++) {
        let oldBranch = branches[i];
        let newBranch = branches[i + 1];
        let oldBranchName = oldBranch.name;
        let newBranchName = newBranch.name;

        // reverse compare branch to check whether it is possible to fast-forward
        let merged = await hasBeenMergedTo(which, newBranch, [oldBranch]);
        if (merged) {
            console.assert(merged === oldBranch);

            let moveTo = oldBranch.newCommitSha || oldBranch.commit.oid;
            if (newBranch.commit.oid !== moveTo) {
                console.log(`  Fast-forward on '${which.repo}', '${newBranchName}' -> '${oldBranchName}'`);
                newBranch.newCommitSha = moveTo;
                await updateBranch(new Which(which.owner, which.repo, newBranchName), moveTo);
            }
            else {
                // identical, no need to merge
            }
            continue;
        }

        // try to merge directly
        const res = await mergeBranch(which, newBranchName, oldBranchName);
        if (res.status === mergeBranch.Merged) {
            console.log(chalk.cyan(`Merged on '${which.repo}', '${oldBranchName}' -> '${newBranchName}'`));
            newBranch.newCommitSha = res.sha;
        }
        else if (res.status === mergeBranch.Conflict) {
            // checks if merged to newer branches
            let newBranches = branches.slice(i + 2);
            let mergedTo = await hasBeenMergedTo(which, oldBranch, newBranches);
            if (mergedTo) {
                console.log(`    '${which.repo}/${oldBranchName}' has previously been merged into '${mergedTo.name}', cancel merge to '${newBranchName}'.`);
            }
            else {
                console.warn(`    Can’t automatically merge branches of '${which.repo}', from '${oldBranchName}' into '${newBranchName}'.`);
                return {
                    which,
                    oldBranch: oldBranchName,
                    newBranch: newBranchName,
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
    let { repos, branches } = await queryDependReposFromAllBranches();
    // sync document
    repos.push(new Which(settings.creatorGithub.owner, 'creator-docs'));

    if (syncRepos) {
        repos = repos.filter(x => syncRepos.includes(x.repo));
    }

    // sync

    let endTimer = utils.timer(`synchronize repos`);
    let promises = [];
    if (!syncRepos || syncRepos.includes(fireball.repo)) {
        promises.push(syncBranch(fireball, branches));
    }
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
