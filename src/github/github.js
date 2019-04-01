
const defaults = require('lodash/defaults');
const utils = require('../utils');
const { dirname, basename } = require('path');

// read token

const settings = utils.getSettings();
const token = settings.creatorGithub.token;
if (!token) {
    console.error('Can not get githubToken from custom settings.js');
}
const auth = `bearer ${token}`;
const ua = 'Cocos Workflows';

// init graphql

const graphql = require('@octokit/graphql').defaults({
    headers: {
        'user-agent': ua,
        authorization: `bearer ${token}`
    },
});

// init rest

const Octokit = require('@octokit/rest');
const restClient = new Octokit({
    auth,
    userAgent: ua,
});

//

async function request (query, variables) {
    let res;
    try {
        // console.log(query);
        res = await graphql(query, variables);
        // console.log(res);
    }
    catch (e) {
        console.error(e.message);
        console.error('  Request failed:', e.request);
        throw e;
    }
    return res;
}

async function querySha (which) {
    let variables = which.toJSON();
    variables.qualifiedName = `refs/heads/${which.branch}`;
    console.log(`querying sha on ${which}`);
    let res = await request(`query ($owner: String!, $repo: String!, $qualifiedName: String!) {
  repository(owner: $owner, name: $repo) {
    ref (qualifiedName: $qualifiedName) {
      target {
        ... on Commit {
          oid
        }
      }
    }
  }
}`, variables);
    if (!res) {
        throw `Failed to access ${which}`;
    }
    return res.repository.ref.target.oid;
}

async function createBranch (which, sha) {
    console.log(`creating branch ${which}`);
    try {
        // let res = await restClient.request(`POST /repos/${which.owner}/${which.repo}/git/refs`, {
        //     ref: `refs/heads/${which.branch}`,
        //     sha: sha
        // });
        await restClient.git.createRef({
            owner: which.owner,
            repo: which.repo,
            ref: `refs/heads/${which.branch}`,
            sha,
        });
    }
    catch (e) {
        if (e.message === 'Reference already exists') {
            return false;
        }
        else if (e.message === 'Not Found' || e.message === 'Bad credentials') {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
    }
    return true;
}

async function commit (which, url, content, message) {
    console.log(`committing content to ${which} ${url}`);

    let file = basename(url);
    if (file !== url) {
        throw 'The ability to parse sub git tree has not yet been implemented';
    }
    let res;

    // Get the current commit object, retrieve the tree it points to
    //   see https://developer.github.com/v3/git/

    let variables = which.toJSON();
    variables.qualifiedName = `refs/heads/${which.branch}`;
    console.log(`  querying last commit...`);
    res = await request(`query ($owner: String!, $repo: String!, $qualifiedName: String!) {
  repository(owner: $owner, name: $repo) {
    ref (qualifiedName: $qualifiedName) {
      target {
        ... on Commit {
          oid
          tree {
            oid
          }
        }
      }
    }
  }
}`, variables);
    if (!res) {
        throw `Failed to query ${variables.qualifiedName}`;
    }
    let { repository: { ref: { target: { oid: parentCommitSha, tree: { oid: parentTreeSha }}}}} = res;

    // get tree

    console.log(`  querying last tree...`);
    res = await restClient.git.getTree({ owner: which.owner, repo: which.repo, tree_sha: parentTreeSha });
    if (res.data.truncated) {
        throw `Tree data truncated, see https://developer.github.com/v3/git/trees/`;
    }
    let tree = res.data.tree;
    let itemIndex = tree.findIndex(x => x.path === file);
    if (itemIndex === -1) {
        throw `Failed to find ${url} in the tree`;
    }

    // // post a new blob object with that new content, getting a blob SHA back
    // console.log(`  posting new blob...`);
    // res = await restClient.git.createBlob({
    //     owner: which.owner,
    //     repo: which.repo,
    //     content,
    //     encoding: 'utf-8',
    // });
    // console.log('  blob sha: ' + res.data.sha); // 95dcc7debc367190fb2eb50f95ae5d83a620c6e3

    // update tree

    let oldItem = tree[itemIndex];
    tree[itemIndex] = {
        path: oldItem.path,
        mode: oldItem.mode,
        type: oldItem.type,
        content
    };

    // create tree

    console.log(`  posting new tree...`);
    res = await restClient.git.createTree({ owner: which.owner, repo: which.repo, tree, base_tree: parentTreeSha });
    let newTreeSha = res.data.sha;
    console.log('  tree sha: ' + res.data.sha); // 9c1e0fa31047b30e5e5a8e80f106b136d1d911a9

    // make a new commit

    console.log(`  creating new commit...`);
    res = await restClient.git.createCommit({
        owner: which.owner,
        repo: which.repo,
        message,
        tree: newTreeSha,
        parents: [parentCommitSha],
    });
    let newCommitSha = res.data.sha;
    console.log(`  New Commit: ${res.data.html_url}`);

    // update branch

    console.log(`  updating ref...`);
    await restClient.git.updateRef({
        owner: which.owner,
        repo: which.repo,
        ref: `heads/${which.branch}`,
        sha: newCommitSha,
    });
}

const downloadUrlRE = /github\.com\/([^\/]+)\/([^\/]+).+\/(.+)\.zip$/;

class Which {
    constructor (owner, repo, branch) {
        this.owner = owner;
        this.repo = repo;
        this.branch = branch;
    }
    toString () {
        return `${this.owner}/${this.repo}/${this.branch}`;
    }
    toJSON () {
        return {
            owner: this.owner,
            repo: this.repo,
            branch: this.branch,
        };
    }
    toDownloadUrl () {
        return `https://github.com/${this.owner}/${this.repo}/archive/${this.branch}.zip`;
    }
    static fromDownloadUrl (url) {
        let match = url.match(downloadUrlRE);
        if (match) {
            return new Which(match[1], match[2], match[3]);
        }
        else {
            return null;
        }
    }
}

module.exports = {
    Which,
    request,
    querySha,
    createBranch,
    commit,
};
