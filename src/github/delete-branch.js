
const chalk = require('chalk');

const { Which, deleteBranch, hasBranchBeenMergedTo, createTag, queryBranches, request, requestFromAllPages } = require('./github');
const { getFireball, queryDependReposFromAllBranches, sortBranches, initBranch } = require('./utils');
const utils = require('../utils');


const program = require('commander');
(function initArgs () {
    program
    .option('-b, --branch <branch>', 'Delete branch')
    .option('--df, --delete-feature', 'Force the deletion of a feature branch')
    .option('--du, --delete-unmerged', 'Force the deletion of an unmerged branch')
    .parse(process.argv);

    if (!program.deleteFeature) {
        let branch = { name: program.branch };
        initBranch(branch);
        if (!branch.isMainChannel) {
            console.error(`Should not delete feature branch, add parameter --df to force delete feature branch`);
            process.exit(1);
        }
    }
    if (program.deleteUnmerged) {
        console.log(`Force delete unmerged branch '${program.branch}'`);
    }
    else {
        console.log(`Delete merged branch '${program.branch}'`);
    }
})();

process.on('unhandledRejection', (reason) => {
    console.error(chalk.red(reason.stack || reason));
});

const GET_VERSION_RE = /^v(\d+\.\d+(?:\.\d+)?)(?:-release)?$/i;
function getTagName (name) {
    let match = GET_VERSION_RE.exec(name);
    if (match) {
        return match[1];
    }
    else {
        return name;
    }
}

function getUniqueTagName (name) {
    return `deleted-branch-${name}`;
}

async function checkPullRequests (which) {
    // const endTimer = utils.timer(`query pull requests of ${which}`);

    let query = `query pr ($owner: String!, $repo: String!, $branch: String!, PageVarDef) {
  repository(owner: $owner, name: $repo) {
    pullRequests (states: OPEN, baseRefName: $branch, PageVar) {
      nodes {
        url
        author {
          login
        }
        number
        id
      }
      PageRes
    }
  }
}`;
    let variables = {
        owner: which.owner,
        repo: which.repo,
        branch: which.branch
    };
    let prs = await requestFromAllPages(query, variables, res => {
        let repository = res.repository;
        if (!repository) {
            throw `Failed to access ${which.repo}, please check permission of the token`;
        }
        return repository.pullRequests;
    });

    // endTimer();
    return prs;
}

async function reopenPullRequests (which, prs) {
    {
        let mutation = `mutation reopen ($input: ReopenPullRequestInput!) {
  reopenPullRequest (input: $input) {
    clientMutationId
  }
}`;
        let variables = {
            input: {
                pullRequestId: "",
            }
        };
        for (let pr of prs) {
            variables.input.pullRequestId = pr.id;
            console.warn(`  Reopen pull request of '${which}': ${pr.url}`);
            await request(mutation, variables);
        }
    }
    {
        const endTimer = utils.timer(`comment ${prs.length} pull requests of ${which}`);
        let mutation = `mutation comment ($input: AddPullRequestReviewInput!) {
  addPullRequestReview (input: $input) {
    clientMutationId
  }
}`;
        let variables = {
            input: {
                pullRequestId: "",
                body: "",
                event: "REQUEST_CHANGES"
            }
        };
        for (let pr of prs) {
            variables.input.pullRequestId = pr.id;
            variables.input.body = `@${pr.author.login}, **${which.branch}** branch has been deleted, so this PR was forced close by GitHub and has now been reopened. We're sorry about the inconvenience.
To fully restore this PR, you can try first click the **Edit** button on the right side of the PR title, then switch **base** to **another** valid branch.
If necessary, welcome to resubmit a PR to other branches, thank you!`;
            await request(mutation, variables);
        }
        endTimer();
    }
}

async function processBranch (which) {
    // const endTimer = utils.timer(`delete branch '${which}'`);

    let branches = await queryBranches(which);
    branches.forEach(initBranch);
    let branch = branches.find(x => x.name === which.branch);
    if (branch) {
        if (!program.deleteUnmerged) {
            // check merge state
            let restBranches = branches.filter(x => x !== branch);
            sortBranches(restBranches);
            let merged = await hasBranchBeenMergedTo(which, branch.name, restBranches);
            if (!merged) {
                console.warn(`  Can not delete unmerged branch '${which}', add parameter --du to force delete`);
                endTimer();
                return { status: processBranch.BranchUnmerged, which };
            }
        }
        // backup a tag
        const sha = branch.target.oid;
        let created = await createTag(which, getTagName(which.branch), sha);
        if (!created) {
            await createTag(which, getUniqueTagName(which.branch), sha);
        }
        // check PRs
        let prs = await checkPullRequests(which);
        // delete
        await deleteBranch(which);
        // reopen PRs
        if (prs.length > 0) {
            await utils.sleep(2000);
            await reopenPullRequests(which, prs);
        }
        console.log(`  branch ${which} deleted from ${sha}`);
    }
    else {
        console.log(chalk.grey(`    Branch '${which}' does not exist, no need to delete.`));
    }

    // endTimer();
}
processBranch.BranchUnmerged = Object.create(null);


(async function () {

    // get dependencies repo branch of Fireball

    let fireball = getFireball(null);
    let { repos } = await queryDependReposFromAllBranches();

    // delete

    let endTimer = utils.timer(`delete branches`);
    let promises = [fireball].concat(repos).map(x => {
        x.branch = program.branch;
        return processBranch(x);
    });
    let status = await Promise.all(promises);
    endTimer();

    // output

    status = status.filter(x => x && x.status === processBranch.BranchUnmerged);
    if (status.length > 0) {
        for (let info of status) {
            console.error(`  Can not delete unmerged branch '${info.which}', add parameter --du to force delete`);
        }
    }
})();
