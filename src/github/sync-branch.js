
const semver = require('semver');
const chalk = require('chalk');
const _ = require('lodash');

const { Which, mergeBranch, queryBranches, hasBranchBeenMergedTo } = require('./github');
const { getFireball, queryDependReposFromAllBranches, sortBranches, fillBranchInfo } = require('./utils');
require('../global-init');
const utils = require('../utils');


async function syncBranch (which, branches) {
    if (!branches) {
        branches = await queryBranches(which);
        branches.forEach(fillBranchInfo);
        branches = branches.filter(x => x.isMainChannel);
        sortBranches(branches);
    }

    const endTimer = utils.timer(`synchronize branches of ${which}`);
    console.log(`    (${branches.map(x => x.name).join(' -> ')})`);

    for (let i = 0; i < branches.length - 1; i++) {
        let oldBranch = branches[i].name;
        let newBranch = branches[i + 1].name;

        // try to merge directly
        const res = await mergeBranch(which, newBranch, oldBranch);
        if (res === mergeBranch.Merged) {
            console.log(`    merged on '${which.repo}', '${oldBranch}' -> '${newBranch}'`);
        }
        else if (res === mergeBranch.Conflict) {
            // checks if merged to newer branches
            let newBranches = branches.slice(i + 2);
            let mergedTo = await hasBranchBeenMergedTo(which, oldBranch, newBranches);
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
    let { repos, branches } = await queryDependReposFromAllBranches();

    // sync

    let endTimer = utils.timer(`synchronize repos`);
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
