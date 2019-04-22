
const chalk = require('chalk');

require('../global-init');
const { Which, querySha, createBranch, commit } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');


let baseBranch = process.argv[2];
let newBranch = process.argv[3];

if (baseBranch === newBranch) {
    console.log(`Invalid branches, they must be difference`);
    process.exit(0);
}
if (newBranch.endsWith('-release')) {
    if (baseBranch + '-release' !== newBranch) {
        console.warn(`Create release branch "${chalk.yellow(newBranch)}" from "${chalk.yellow(baseBranch)}"`);
    }
    else {
        console.log(`Create release branch "${newBranch}" from "${baseBranch}"`);
    }
}
else {
    console.log(`Create normal branch "${newBranch}" from "${baseBranch}"`);
}


function bumpDependRepos (packageContent, packageJson) {
    const { builtin, hosts, templates, externDefs } = packageJson;

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
            replace(`"${entry}"`, `"${repo}#${newBranch}"`);
        });
    }

    bumpRepos(builtin);
    bumpRepos(hosts);

    for (let key in templates) {
        let url = templates[key];
        let entry = Which.fromDownloadUrl(url);
        if (entry) {
            entry.branch = newBranch;
            replace(url, entry.toDownloadUrl());
        }
    }

    if (externDefs) {
        let oldBranch = externDefs['cocos2d-x_branch'];
        replace(`"cocos2d-x_branch": "${oldBranch}"`, `"cocos2d-x_branch": "${newBranch}"`);
    }

    return packageContent;
}

(async function () {

    let fireballBase = getFireball(baseBranch);
    let fireballNew = getFireball(newBranch);

    // create new fireball branch

    let sha = await querySha(fireballBase);
    if (!sha) {
        throw `Can not find ref of ${fireballBase}`;
    }
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
        which.branch = newBranch;
        let created = await createBranch(which, sha);
        if (!created) {
            console.warn(chalk.yellow(`Branch (${which}) already exists. Update the reference if you need.`));
        }
    }

    // update package.json

    packageContent = bumpDependRepos(packageContent, packageJson);

    // commit package.json

    let commitMsg = `Switch dependencies to ${newBranch}`;
    await commit(fireballNew, 'package.json', new Buffer(packageContent), commitMsg);

    console.log(`Finished create branch`);
})();
