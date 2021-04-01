
const chalk = require('chalk');

const { Which, mergeBranch, queryRef, hasBeenMergedTo, updateBranch } = require('./github');
const { getFireball, queryDependReposFromAllBranches, fillBranchInfo } = require('./utils');
require('../global-init');
const utils = require('../utils');
const settings = utils.getSettings();

const program = require('commander');
(function initArgs () {
    program
        .option('-b, --base <branch>')
        .option('-h, --head <branch>')
        .parse(process.argv);

    // console.log('base: ' + program.base);
    // console.log('head: ' + program.head);

    if (!program.base) {
        console.error(`Missing base branch`);
        process.exit(1);
    }
    if (!program.head) {
        console.error(`Missing head branch`);
        process.exit(1);
    }

    console.log(`Merge branch from '${program.head}' to '${program.base}'`);
})();

async function processRepo (which) {
    let head = await queryRef(which, program.head);
    if (!head) {
        console.warn(`    Can not find branch '${program.head}' in '${which.repo}'.`);
        return {
            reason: 'non-exists',
            which,
            branch: program.head,
        };
    }
    fillBranchInfo(head);
    let base = await queryRef(which, program.base);
    if (!base) {
        console.warn(`    Can not find branch '${program.base}' in '${which.repo}'.`);
        return {
            reason: 'non-exists',
            which,
            branch: program.base,
        };
    }
    fillBranchInfo(base);

    const endTimer = utils.timer(`merging branch of ${which}`);

    let headName = head.name;
    let baseName = base.name;

    // reverse compare branch to check whether it is possible to fast-forward
    let merged = await hasBeenMergedTo(which, base, [head]);
    if (merged) {
        console.assert(merged === head);

        let moveTo = head.newCommitSha || head.target.oid;
        if (base.target.oid !== moveTo) {
            console.log(`  Fast-forward on '${which.repo}', '${baseName}' -> '${headName}'`);
            base.newCommitSha = moveTo;
            await updateBranch(new Which(which.owner, which.repo, baseName), moveTo);
        }
        else {
            // identical, no need to merge
        }
        endTimer();
        return;
    }

    // try to merge directly
    const res = await mergeBranch(which, baseName, headName);
    if (res.status === mergeBranch.Merged) {
        console.log(chalk.cyan(`Merged on '${which.repo}', '${headName}' -> '${baseName}'`));
        base.newCommitSha = res.sha;
    }
    else if (res.status === mergeBranch.Conflict) {
        console.warn(`    Can’t automatically merge branches of '${which.repo}', from '${headName}' into '${baseName}'.`);
        return {
            reason: 'conflict',
            which,
            oldBranch: headName,
            newBranch: baseName,
        };
    }

    endTimer();
    return null;
}

(async function () {

    // get dependencies repo branch of Fireball

    let fireball = getFireball(null);
    let { repos } = await queryDependReposFromAllBranches();

    repos.push(
        fireball,
        // also sync document
        new Which(settings.creatorGithub.owner, 'creator-docs')
    );

    // merge

    let endTimer = utils.timer(`merging repos`);

    let tasks = repos.map(processRepo);
    let status = await Promise.all(tasks);

    endTimer();

    // output

    status = status.filter(Boolean);
    if (status.length > 0) {
        for (let info of status) {
            switch (info.reason) {
            case 'conflict':
                console.error(`  Repo: ${chalk.red(info.which)}, can not merge from: ${chalk.red(program.head)}, to: ${chalk.red(program.base)}, please resolve conflict manually`);
                break;
            case 'non-exists':
                console.warn(`  Repo: ${chalk.cyan(info.which)}, branch '${info.branch}' not exists.`);
                break;
            }
        }
    }
})();
