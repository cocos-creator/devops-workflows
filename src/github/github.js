
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
    request: {
        timeout: 10000,
    }
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

const maxRetryCount = 5;
async function request (cmd, variables, retry) {
    let res;
    try {
        // console.log(cmd, variables);
        res = await graphql(cmd, variables);
        // console.log(res);
    }
    catch (e) {
        console.error(`  ${e.message}. Status: ${e.status}.`);
        if (e.message.includes('ETIMEDOUT') || e.message.includes('network timeout at')) {
            retry = retry || 0;
            if (++retry <= maxRetryCount) {
                console.log(`    retry (${retry}/${maxRetryCount}) ...`);
                return request(cmd, variables, retry);
            }
        }
        console.error('  Request failed:', e.request);
        throw e;
    }
    return res;
}

async function requestFromAllPages (query, variables, getConnection) {
    const ITEM_PER_PAGE = 50;

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
        oid
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
        commit: target {
          ... on Commit {
            oid
            pushedDate
          }
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
    // endTimer();

    res = res.filter(x => x.name !== 'gh-pages');
    res.forEach(x => {
        let date = new Date(x.commit.pushedDate);
        x.updatedAt = date.getTime();
    });

    return res;
}

async function _createRef (which, ref, sha) {
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
    return _createRef(which, `refs/heads/${which.branch}`, sha);
}

async function createTag (which, name, sha) {
    console.log(`  creating tag ${name} in ${which.repo}`);
    return _createRef(which, `refs/tags/${name}`, sha);
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
            limitedTasks = limitedTasks.map(x => {
                let promise = runTask(x);
                return (async function () {
                    try {
                        let res = await promise;
                        if (test(res)) {
                            if (found) {
                                return;
                            }
                            found = true;
                            resolve(x);
                        }
                    }
                    catch (e) {
                        if (found) {
                            return;
                        }
                        found = true;
                        reject(e);
                    }
                })();
            });
            await Promise.all(limitedTasks);
        }
        resolve(false);
    });
}

// 判断一个分支是否已经包含在其它分支中
async function hasBranchBeenMergedTo (which, branch, otherBranches) {
    return await findResLimit(otherBranches, x => {
        if (branch.updatedAt > x.updatedAt) {
            // console.log(`${branch.name} updated behind ${x.name}`);
            return Promise.resolve('not-behind');
        }
        else {
            return compareBranches(which, x.name, branch.name);
        }
    }, status => status === 'behind', 6);
}

async function _queryBlob (which, path, field) {
    let variables = which.toJSON();
    variables.expression = `${which.branch}:${path}`;
    let res = await request(`query sha ($owner: String!, $repo: String!, $expression: String!) {
  repository (owner: $owner, name: $repo) {
    blob: object (expression: $expression) {
      ... on Blob {
        ${field}
      }
    }
  }
}`, variables);
    let repository = res.repository;
    if (!repository) {
        throw `Failed to access ${which.repo}, please check permission of the token`;
    }
    let blob = repository.blob;
    if (!blob) {
        throw `Failed to query ${variables.expression}, please check the branch`;
    }
    return blob[field];
}

async function queryText (which, path) {
    return _queryBlob(which, path, 'text');
}

// https://developer.github.com/v3/repos/contents/#update-a-file
async function commit (which, path, buffer, message) {
    console.log(`committing content to ${which}: ${path}`);

    let content = buffer.toString('base64');
    let sha = await _queryBlob(which, path, 'oid');

    let res = await restClient.repos.updateFile({
        owner: which.owner,
        repo: which.repo,
        branch: which.branch,
        path,
        message,
        content,
        sha,
    });

    console.log(`committed: ${res.data.commit.html_url}`);
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

function toDateTime (date) {
    let dt = date.toISOString();            // '2019-04-09T16:57:53.321Z'
    return dt.replace(/\.\d+(?=Z$)/, '');   // '2019-04-09T16:57:53Z'
}

module.exports = {
    Which,
    request,
    requestFromAllPages,
    querySha,
    queryText,
    commit,
    queryBranches,
    createBranch,
    mergeBranch,
    deleteBranch,
    hasBranchBeenMergedTo,
    createTag,
    toDateTime,
};
