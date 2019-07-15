
const chalk = require('chalk');
const semver = require('semver');

require('../global-init');
const { Which, querySha, createBranch, commit } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');


let baseRef = process.argv[2];
let newBranch = process.argv[3];

if (baseRef === newBranch) {
    console.log(`Invalid references, param 1 should not identical with 2`);
    process.exit(0);
}
if (newBranch.endsWith('-release')) {
    if (baseRef + '-release' !== newBranch) {
        // different version
        console.warn(`Create release branch "${chalk.yellow(newBranch)}" from "${chalk.yellow(baseRef)}"`);
    }
    else {
        console.log(`Create release branch "${newBranch}" from "${baseRef}"`);
    }
}
else {
    console.log(`Create normal branch "${newBranch}" from "${baseRef}"`);
}


function updatePackages (packageContent, packageJson) {
    const { builtin, hosts, templates, externDefs } = packageJson;

    // use replace to ensure line ending will not changed or it will be formated by JSON
    function ensureReplace (oldText, newText) {
        packageContent = packageContent.replace(oldText, newText);
        if (packageContent.includes(oldText)) {
            console.error(chalk.red(`Failed to update package.json, includes more than 1 ${oldText}`));
            process.exit(1);
        }
    }

    // bump self version
    let sv = semver.parse(newBranch);
    if (sv) {
        let newVersion = `${sv.major}.${sv.minor}.${sv.patch}`;
        if (newVersion !== packageJson.version) {
            ensureReplace(`"version": "${packageJson.version}",`, `"version": "${newVersion}",`);
        }
    }

    function bumpRepos (repos) {
        return repos.map(entry => {
            let [repo, branch] = entry.split('#');
            if (branch !== newBranch) {
                ensureReplace(`"${entry}"`, `"${repo}#${newBranch}"`);
            }
        });
    }

    bumpRepos(builtin);
    bumpRepos(hosts);

    for (let key in templates) {
        let url = templates[key];
        let entry = Which.fromDownloadUrl(url);
        if (entry && entry.branch !== newBranch) {
            entry.branch = newBranch;
            ensureReplace(url, entry.toDownloadUrl());
        }
    }

    if (externDefs) {
        let oldBranch = externDefs['cocos2d-x_branch'];
        if (oldBranch !== newBranch) {
            ensureReplace(`"cocos2d-x_branch": "${oldBranch}"`, `"cocos2d-x_branch": "${newBranch}"`);
        }
    }

    return packageContent;
}

(async function () {

    let fireballBase = getFireball(baseRef);
    let fireballNew = getFireball(newBranch);

    // create new fireball branch

    let basedOnBranch = true;
    let sha = await querySha(fireballBase);
    if (!sha) {
        // ref is a tag
        basedOnBranch = false;
        fireballBase.branch = undefined;
        sha = await querySha(fireballBase, baseRef);
        if (!sha) {
            throw `Can not find ref of ${fireballBase}`;
        }
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
        let sha;
        if (basedOnBranch) {
            sha = await querySha(which);
            if (!sha) {
                throw `Can not find branch '${which}', check the dependencies please.`;
            }
        }
        else {
            which.branch = undefined;
            sha = await querySha(which, baseRef);
            if (!sha) {
                throw `Can not find tag '${baseRef}' of ${which}, check the dependencies please.`;
            }
        }
        which.branch = newBranch;
        let created = await createBranch(which, sha);
        if (!created) {
            console.warn(chalk.yellow(`Branch (${which}) already exists. Update the reference if you need.`));
        }
    }

    // update package.json

    let newPackageContent = updatePackages(packageContent, packageJson);
    if (newPackageContent !== packageContent) {
        // commit package.json

        let commitMsg = `Switch all dependencies to ${newBranch}`;
        await commit(fireballNew, 'package.json', new Buffer(newPackageContent), commitMsg);
    }
    else {
        console.log('Checked package.json, no need to update.');
    }

    console.log(`Finished create branch`);
})();
