
const chalk = require('chalk');

const { Which, deleteBranch, hasBeenMergedTo, createTag, request, requestFromAllPages } = require('./github');
const { getFireball, queryDependReposFromAllBranches, queryBranchesSortedByTime, fillBranchInfo } = require('./utils');
require('../global-init');
const utils = require('../utils');


const program = require('commander');
(function initArgs () {
    program
    .option('--df, --delete-feature', 'Force the deletion of a feature branch')
    .option('--du, --delete-unmerged', 'Force the deletion of an unmerged branch')
    .parse(process.argv);
    program.branch = process.argv[2];
    if (process.argv[3] && !process.argv[3].startsWith('-')) {
        program.subsequentBranch = process.argv[3];
        console.log(`Base branches of related PRs will be changed to '${program.subsequentBranch}'`);
    }

    if (!program.deleteFeature) {
        let branch = fillBranchInfo(program.branch);
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

async function queryUnmergedPullRequests (which) {
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

// async function reopenPullRequests (which, prs) {
//     {
//         let mutation = `mutation reopen ($input: ReopenPullRequestInput!) {
//   updatePullRequest (input: $input) {
//     clientMutationId
//   }
// }`;
//         let variables = {
//             input: {
//                 pullRequestId: "",
//             }
//         };
//         for (let pr of prs) {
//             variables.input.pullRequestId = pr.id;
//             console.warn(chalk.yellow(`  Reopen pull request of '${which}': ${pr.url}`));
//             await request(mutation, variables);
//         }
//     }
//     {
//         const endTimer = utils.timer(`comment ${prs.length} pull requests of ${which}`);
//         let mutation = `mutation comment ($input: AddPullRequestReviewInput!) {
//   addPullRequestReview (input: $input) {
//     clientMutationId
//   }
// }`;
//         let variables = {
//             input: {
//                 pullRequestId: "",
//                 body: "",
//                 event: "REQUEST_CHANGES"
//             }
//         };
//         for (let pr of prs) {
//             variables.input.pullRequestId = pr.id;
//             variables.input.body = `@${pr.author.login}, **${which.branch}** branch has been deleted, so this PR was forced close by GitHub and has now been reopened. We're sorry about the inconvenience.
// To fully restore this PR, you can try first click the **Edit** button on the right side of the PR title, then switch **base** to **another** valid branch.
// If necessary, welcome to resubmit a PR to other branches, thank you!`;
//             await request(mutation, variables);
//         }
//         endTimer();
//     }
// }

async function changeBaseRefOfPullRequests (which, prs, newBase) {
    let failedPRs = [];

    // edit base

    {
        let mutation = `mutation editBase ($input: UpdatePullRequestInput!) {
  updatePullRequest (input: $input) {
    clientMutationId
  }
}`;
        let variables = {
            input: {
                pullRequestId: "",
                baseRefName: newBase
            }
        };
        for (let i = prs.length - 1; i >= 0; i--) {
            let pr = prs[i];
            variables.input.pullRequestId = pr.id;
            console.warn(chalk.yellow(`  Set base branch of ${pr.url} to '${newBase}'`));
            try {
                await request(mutation, variables);
            }
            catch (e) {
                let error = e.errors[0];
                if (e.errors.length === 1 && error.type === 'UNPROCESSABLE') {
                    // branch not found or no new commit
                    console.warn(chalk.yellow(`  Can not change base branch of ${pr.url}, please manually verify it. (${error.message})`));
                    failedPRs.push(pr);
                    prs.splice(i, 1);
                }
                else {
                    // unknown error
                    throw e;
                }
            }
        }
        await utils.sleep(2000);
    }

    // comment

    if (prs.length > 0) {
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
                event: "COMMENT"
            }
        };
        for (let pr of prs) {
            variables.input.pullRequestId = pr.id;
            variables.input.body = `@${pr.author.login}, **${which.branch}** branch will be deleted, so we edited the base branch to **${newBase}**, or this PR will be killed by GitHub.
Please review the commits history to ensure that the PR does not polluted by unneeded commits from your origin branch.
If you need to merge to other branch, you can first click the **Edit** button on the right side of the PR title, then switch the **base** branch.
If necessary, welcome to resubmit a new PR. Thanks!`;
            await request(mutation, variables);
        }
        endTimer();
    }

    return failedPRs;
}

async function processBranch (which) {
    // const endTimer = utils.timer(`delete branch '${which}'`);

    let branches = await queryBranchesSortedByTime(which);
    let branch = branches.find(x => x.name === which.branch);
    if (branch) {
        if (!program.deleteUnmerged) {
            // check merge state
            let restBranches = branches.filter(x => x !== branch);
            let merged = await hasBeenMergedTo(which, branch, restBranches);
            if (!merged) {
                console.warn(`  Can not delete unmerged branch '${which}', add parameter --du to force delete`);
                // endTimer();
                return { status: processBranch.BranchUnmerged, which };
            }
        }
        // backup a tag
        const sha = branch.commit.oid;
        let created = await createTag(which, getTagName(which.branch), sha);
        if (!created) {
            await createTag(which, getUniqueTagName(which.branch), sha);
        }
        // check PRs
        let usedPRs = await queryUnmergedPullRequests(which);
        if (usedPRs.length > 0) {
            if (program.subsequentBranch) {
                // edit base
                usedPRs = await changeBaseRefOfPullRequests(which, usedPRs, program.subsequentBranch);
                if (usedPRs.length > 0) {
                    return { status: processBranch.PrRebaseFailed, prs: usedPRs };
                }
            }
            else {
                return { status: processBranch.NoRebaseBranch, prs: usedPRs };
            }
        }
        // delete
        await deleteBranch(which);
        console.log(`  Branch ${which} deleted from ${sha}`);
    }
    else {
        console.log(chalk.grey(`    Branch '${which}' does not exist, no need to delete.`));
    }

    // endTimer();
}
processBranch.BranchUnmerged = Object.create(null);
processBranch.PrRebaseFailed = Object.create(null);
processBranch.NoRebaseBranch = Object.create(null);


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

    let unmergedRepo = status.filter(x => x && x.status === processBranch.BranchUnmerged).map(x => x.which);
    if (unmergedRepo.length > 0) {
        console.log('');
        for (let which of unmergedRepo) {
            console.error(chalk.red(`Can not delete unmerged branch '${which}', add parameter --du to force delete`));
        }
    }
    let prsRebaseFailed = status.filter(x => x && x.status === processBranch.PrRebaseFailed).map(x => x.prs);
    if (prsRebaseFailed.length > 0) {
        console.log('');
        console.error(chalk.red(`Can not change base branch of PR to '${program.subsequentBranch}':`));
        for (let prs of prsRebaseFailed) {
            for (let pr of prs) {
                console.error(chalk.red(`  ${pr.url}`));
            }
        }
        console.error(chalk.red(`please verify manually before the branch being deleted.`));
    }
    let prsNeedRebase = status.filter(x => x && x.status === processBranch.NoRebaseBranch).map(x => x.prs);
    if (prsNeedRebase.length > 0) {
        console.log('');
        console.error(chalk.red(`Can not delete target branch used by PR:`));
        for (let prs of prsNeedRebase) {
            for (let pr of prs) {
                console.error(chalk.red(`  ${pr.url}`));
            }
        }
        console.error(chalk.red(`you can specify a 'subsequentBranch' to change its base branch automatically.`));
    }
})();
