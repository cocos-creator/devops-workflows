
const chalk = require('chalk');

const utils = require('../utils');
const settings = utils.getSettings();
const { Which, request, querySha, createBranch, commit } = require('./github');
const { getFireball, getMainPackage, parseDependRepos } = require('./utils');

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red(reason.stack || reason));
});

// args

const baseBranches = process.argv.slice(2);
const currentBranch = baseBranches[baseBranches.length - 1];
console.log(`List open pull requests based on branch ${baseBranches}, current branch: ${currentBranch}`);

//

const DONT_MERGE_RE = /\bWIP\b|\bDo(?:n'?t| not)\s*Merge\b/i;
function canMerge (node) {
    if (DONT_MERGE_RE.test(node.title)) {
        console.log(`    skip PR "${node.title}"`);
        return false;
    }
    let skipLabelIndex = node.labels.nodes.findIndex(x => DONT_MERGE_RE.test(x.name));
    if (skipLabelIndex !== -1) {
        console.log(`    skip PR "${node.title}" (label: "${node.labels.nodes[skipLabelIndex].name}")`);
        return false;
    }
    return true;
}

async function queryPRs (which, baseBranches) {
    const ITEM_PER_PAGE = 20;
    const taskName = `querying pull requests of ${which.owner}/${which.repo}...`;
    console.log('  Start ' + taskName);
    const timerName = '  Finished ' + taskName;
    console.time(timerName);
    let prs = [];
    let query = `query pr ($owner: String!, $repo: String!, $after: String, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequests (after: $after, first: $first, states: OPEN, orderBy: {
      direction: ASC,
      field: CREATED_AT
    }) {
      nodes {
        title
        labels (first: 10) {
          nodes {
            name
          }
        }
        url
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`;
    let variables = {
        owner: which.owner,
        repo: which.repo,
        first: ITEM_PER_PAGE,
        after: undefined,
    };
    for (;;) {
        let res = await request(query, variables);
        let repository = res.repository;
        if (!repository) {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        let { nodes, pageInfo: { hasNextPage, endCursor } } = repository.pullRequests;

        nodes = nodes.filter(canMerge).filter(x => baseBranches.includes(x.baseRefName));
        prs = prs.concat(nodes);

        if (!hasNextPage) {
            break;
        }
        console.log(`    querying next page...`);
        variables.after = endCursor;
    }
    if (prs.length > 0) {
        console.log(prs);
    }

    console.timeEnd(timerName);
    // console.log(`  Finished querying pull requests of ${which.owner}/${which.repo}...`);
    return prs;
}

//

(async function () {
    const timerName = `Finished list pull requests`;
    console.time(timerName);

    let fireball = getFireball(currentBranch);

    // parse repos

    let packageContent = await getMainPackage(fireball);
    let packageJson = JSON.parse(packageContent);
    let repos = parseDependRepos(packageJson);

    // list pr

    let promises = [queryPRs(fireball, baseBranches)];
    promises = promises.concat(repos.map(x => queryPRs(x, baseBranches)));
    await Promise.all(promises);

    console.timeEnd(timerName);
})();
