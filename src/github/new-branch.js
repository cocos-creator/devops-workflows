
const chalk = require('chalk');

const { Which, querySha, createBranch, commit } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');

const program = require('commander');

(function initArgs () {
    program
        .option('-b, --baseAndNewBranch <baseBranch,newBranch>', 'Create new branches', val => val.split(','))
        .parse(process.argv);
    // console.log(program.baseAndNewBranch);
    program.baseBranch = program.baseAndNewBranch[0];
    program.newBranch = program.baseAndNewBranch[1];
    if (program.baseBranch === program.newBranch) {
        console.log(`Invalid branches, they must be difference`);
        process.exit(0);
    }
    if (program.newBranch.endsWith('-release')) {
        if (program.baseBranch + '-release' !== program.newBranch) {
            console.warn(`Create release branch "${chalk.yellow(program.newBranch)}" from "${chalk.yellow(program.baseBranch)}"`);
        }
        else {
            console.log(`Create release branch "${program.newBranch}" from "${program.baseBranch}"`);
        }
    }
    else {
        console.log(`Create normal branch "${program.newBranch}" from "${program.baseBranch}"`);
    }
    // if (program.baseBranch && program.newBranch) {
    // }
})();

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red(reason.stack || reason));
});


function bumpDependRepos (packageContent, packageJson) {
    const { builtin, hosts, templates } = packageJson;

    // use replace to ensure line ending will not changed or it will be formated by JSON
    function replace (oldText, newText) {
        packageContent = packageContent.replace(oldText, newText);
        if (packageContent.includes(oldText)) {
            console.error(chalk.red(`Failed to update package.json, includes more than 1 ${oldText}`));
            process.exit(1);
        }
    }

    function bumpRepos (repos) {
        return repos.map(entry => {
            let [repo, branch] = entry.split('#');
            replace(`"${entry}"`, `"${repo}#${program.newBranch}"`);
        });
    }

    bumpRepos(builtin);
    bumpRepos(hosts);

    for (let key in templates) {
        let url = templates[key];
        let entry = Which.fromDownloadUrl(url);
        if (entry) {
            entry.branch = program.newBranch;
            replace(url, entry.toDownloadUrl());
        }
    }

    return packageContent;
}

(async function () {

    let fireballBase = getFireball(program.baseBranch);
    let fireballNew = getFireball(program.newBranch);

    // create new fireball branch

    let sha = await querySha(fireballBase);
    let created = await createBranch(fireballNew, sha);
    if (!created) {
        console.warn(chalk.yellow(`Branch (${fireballNew}) already exists. Parse dependencies based on new branch.`));
    }

    // parse repos

    let packageContent = await getMainPackage(fireballNew);
    let packageJson = JSON.parse(packageContent);
    let repos = parseDependRepos(packageJson);

    // create depend branches

    for (let which of repos) {
        let sha = await querySha(which);
        which.branch = program.newBranch;
        let created = await createBranch(which, sha);
        if (!created) {
            console.warn(chalk.yellow(`Branch (${which}) already exists. Update the reference if you need.`));
        }
    }

    // update package.json

    packageContent = bumpDependRepos(packageContent, packageJson);

    // commit package.json

    let commitMsg = `Switch dependencies to ${program.newBranch}`;
    await commit(fireballNew, 'package.json', new Buffer(packageContent), commitMsg);

    console.log(`Finished create branch`);
})();
