
const utils = require('../utils');
const settings = utils.getSettings();
const { Which, request, querySha, createBranch, commit } = require('./github');

async function getMainPackage (which) {
    console.log('  querying package.json...');
    let res = await request(`query ($owner: String!, $repo: String!, $packageExp: String!) {
  repository(owner: $owner, name: $repo) {
    object(expression: $packageExp) {
      ... on Blob {
        text
      }
    }
  }
}`, {
        owner: which.owner,
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

module.exports = {
    getFireball (branch) {
        return new Which(settings.creatorGithub.owner, 'fireball', branch);
    },
    getMainPackage,
    parseDependRepos,
};
