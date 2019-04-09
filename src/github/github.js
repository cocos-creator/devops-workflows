
const { basename } = require('path');
const utils = require('../utils');

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
        authorization: auth,
        'user-agent': ua
    },
});

// init rest
//   see: https://github.com/octokit/rest.js

const Octokit = require('@octokit/rest')
    .plugin(require('@octokit/plugin-throttling'));
const restClient = new Octokit({
    auth,
    userAgent: ua,
    throttle: {
        onRateLimit (retryAfter, options) {
            restClient.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);

            if (options.request.retryCount === 0) { // only retries once
                console.log(`Retrying after ${retryAfter} seconds!`);
                return true;
            }
        },
        onAbuseLimit (retryAfter, options) {
            // does not retry, only logs a warning
            restClient.log.warn(`Abuse detected for request ${options.method} ${options.url}`)
        }
    }
});

//

const maxRetryCount = 3;
async function request (cmd, variables, retry) {
    let res;
    try {
        // console.log(cmd, variables);
        res = await graphql(cmd, variables);
        // console.log(res);
    }
    catch (e) {
        console.error(`${e.message}. Status: ${e.status}.`);
        if (e.message.includes('ETIMEDOUT')) {
            retry = retry || 0;
            if (++retry < maxRetryCount) {
                console.log(`    retry (${retry}/${maxRetryCount}) ...`);
                return request(cmd, variables, retry + 1);
            }
        }
        console.error('  Request failed:', e.request);
        throw e;
    }
    return res;
}

async function requestFromAllPages (query, variables, getConnection) {
    const ITEM_PER_PAGE = 20;

    let allNodes = [];

    query = query
        .replace('PageRes', `pageInfo {\n    hasNextPage\n    endCursor\n  }`)
        .replace('PageVarDef', `$after: String, $first: Int!`)
        .replace('PageVar', `after: $after, first: $first`);

    variables.first = ITEM_PER_PAGE;
    variables.after = undefined;

    for (;;) {
        let res = await request(query, variables);
        let { nodes, pageInfo: { hasNextPage, endCursor } } = getConnection(res);
        allNodes = allNodes.concat(nodes);

        if (!hasNextPage) {
            break;
        }
        console.log(`    querying next page...`);
        variables.after = endCursor;
    }

    return allNodes;
}

async function querySha (which) {
    let variables = which.toJSON();
    variables.qualifiedName = `refs/heads/${which.branch}`;
    console.log(`    querying sha of '${which}'`);
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
    if (!res.repository.ref) {
        // branch does not exist
        return null;
    }
    return res.repository.ref.target.oid;
}

async function queryBranches (which) {
    // const endTimer = utils.timer(`  query branches of ${which}`);

    let query = `
query branches ($owner: String!, $repo: String!, PageVarDef) {
  repository(owner: $owner, name: $repo) {
    refs(refPrefix: "refs/heads/", direction: DESC, PageVar) {
      nodes {
        name
        target {
          oid
        }
      }
      PageRes
    }
  }
}`;
    let variables = {
        owner: which.owner,
        repo: which.repo,
    };
    let res = await requestFromAllPages(query, variables, res => {
        let repository = res.repository;
        if (!repository) {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        return repository.refs;
    });

    res = res.filter(x => x.name !== 'gh-pages');

    // endTimer();
    return res;
}

async function createRef (which, ref, sha) {
    try {
        let res = await restClient.git.createRef({
            owner: which.owner,
            repo: which.repo,
            ref,
            sha,
        });
        // console.log(res);
    }
    catch (e) {
        if (e.message === 'Reference already exists') {
            return false;
        }
        else if (e.message === 'Not Found' || e.message === 'Bad credentials') {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        else {
            throw e;
        }
    }
    return true;
}

async function createBranch (which, sha) {
    console.log(`  creating branch ${which}`);
    return createRef(which, `refs/heads/${which.branch}`, sha);
}

async function createTag (which, name, sha) {
    console.log(`  creating tag ${name} in ${which.repo}`);
    return createRef(which, `refs/tags/${name}`, sha);
}

async function mergeBranch (which, base, head) {
    // console.log(`merging branch of ${which.owner}/${which.repo}/${head} into ${base}`);
    try {
        const res = await restClient.repos.merge({
            owner: which.owner,
            repo: which.repo,
            base,
            head,
            commit_message: `Sync branch ${head} to ${base}`,
        });
        // console.log(res);
        if (res.status === 204) {
            // base already contains the head, nothing to merge
            return mergeBranch.Noop;
        }
        else {
            // merged
            return mergeBranch.Merged;
        }
    }
    catch (e) {
        if (e.status === 409) {
            // conflict
            return mergeBranch.Conflict;
        }
        throw e;
    }
}

mergeBranch.Merged = new Object();
mergeBranch.Conflict = new Object();
mergeBranch.Noop = new Object();

async function compareBranches (which, base, head) {
    console.log(`    comparing branch ${head} with ${base}`);
    try {
        const res = await restClient.repos.compareCommits({
            owner: which.owner,
            repo: which.repo,
            base,
            head,
        });
        // res.data.status === 'behind|diverged|ahead';
        return res.data.status;
    }
    catch (e) {
        if (e.status === 404) {
            console.error(`Branch ${base} or ${head} not in ${which}`);
        }
        throw e;
    }
}

// 直接删除分支，不做任何检查
async function deleteBranch (which) {
    try {
        await restClient.git.deleteRef({
            owner: which.owner,
            repo: which.repo,
            ref: `heads/${which.branch}`,
            // ref: `tags/${which.branch}`,
        });
        // res.status === 204
        // res.data === undefined
    }
    catch (e) {
        if (e.status === 404) {
            console.error(`Branch ${which} not exists or don't have permission`);
        }
        throw e;
    }
}

async function findResLimit (array, runTask, test, limit) {
    return new Promise(async (resolve, reject) => {
        for (let i = 0, found = false; i < array.length && !found; i += limit) {
            let limitedTasks = array.slice(i, Math.min(i + limit, array.length));
            // console.log('testing ' + limitedTasks);
            limitedTasks = limitedTasks.map(runTask).map(async x => {
                try {
                    let res = await x;
                    if (test(res)) {
                        if (found) {
                            return;
                        }
                        found = true;
                        resolve(true);
                    }
                }
                catch (e) {
                    if (found) {
                        return;
                    }
                    found = true;
                    reject(e);
                }
            });
            await Promise.all(limitedTasks);
        }
        resolve(false);
    });
}

// 判断一个分支是否已经包含在其它分支中
async function hasBranchBeenMergedTo (which, branch, otherBranches) {
    otherBranches = otherBranches.map(x => x.name);
    return await findResLimit(otherBranches, x => compareBranches(which, x, branch), status => status === 'behind', 6);
}

// TODO - replace with https://developer.github.com/v3/repos/contents/#update-a-file
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
        if (this.branch) {
            return `${this.owner}/${this.repo}/${this.branch}`;
        }
        else {
            return `${this.owner}/${this.repo}`;
        }
    }
    toJSON () {
        return {
            owner: this.owner,
            repo: this.repo,
            branch: this.branch,
        };
    }
    get url () {
        return `https://github.com/${this.owner}/${this.repo}`;
    }
    toDownloadUrl () {
        return `${this.url}/archive/${this.branch}.zip`;
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
    requestFromAllPages,
    querySha,
    commit,
    queryBranches,
    createBranch,
    mergeBranch,
    compareBranches,
    deleteBranch,
    hasBranchBeenMergedTo,
    createTag,
};
