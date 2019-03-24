
const chalk = require('chalk');

const { Which, request, querySha, createBranch, commit } = require('./github');
const utils = require('../utils');
const settings = utils.getSettings();

const program = require('commander');

(function initArgs () {
    program
        .option('-b, --baseAndNewBranch <baseBranch,newBranch>', 'create new branches', val => val.split(','))
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

async function getMainPackage (which) {
    let res = await request(`query ($owner: String!, $repo: String!, $packageExp: String!) {
  repository(owner: $owner, name: $repo) {
    object(expression: $packageExp) {
      ... on Blob {
        text
      }
    }
  }
}`, {
        repo: which.repo,
        packageExp: `${which.branch}:package.json`,
    });

    let repository = res.repository;
    if (!repository) {
        throw `Failed to access ${which.repo}, please check permission of the token`;
    }
    let object = repository.object;
    if (!object) {
        throw `Failed to load package.json from ${which}, please check the branch`;
    }

    return object.text;
}

// get repos from package.json {
//   builtin
//   hosts
//   templates (github.com)
// }
function parseDependRepos (package) {
    const { builtin, hosts, templates } = package;
    const { creatorGithub: { owner, ownerPackages} } = settings;

    function parseRepos (repos, owner) {
        return repos.map(entry => {
            let [repo, branch] = entry.split('#');
            return new Which(owner, repo, branch);
        });
    }
    let repos = [];
    repos = repos.concat(parseRepos(builtin, ownerPackages));
    repos = repos.concat(parseRepos(hosts, owner));

    for (let key in templates) {
        let url = templates[key];
        let entry = Which.fromDownloadUrl(url);
        if (entry) {
            repos.push(entry);
        }
    }

    return repos;
}

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

    let fireball = new Which(settings.creatorGithub.owner, 'fireball', program.baseBranch);

    // parse repos

    let packageContent = await getMainPackage(fireball);
    let packageJson = JSON.parse(packageContent);
    let repos = parseDependRepos(packageJson);

    // create branches

    for (let which of repos) {
        let sha = await querySha(which);
        which.branch = program.newBranch;
        let created = await createBranch(which, sha);
        if (!created) {
            console.warn(chalk.yellow(`Branch already exists. Update the reference if you need.`));
        }

    }

    // update package.json

    packageContent = bumpDependRepos(packageContent, packageJson);

    // commit package.json

    fireball.branch = program.newBranch;
    let commitMsg = `Switch branches to ${program.newBranch}`;
    await commit(fireball, 'package.json', packageContent, commitMsg);

    console.log(`Finished create branch`);
})();
