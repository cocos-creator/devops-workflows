
const chalk = require('chalk');
const _ = require('lodash');

require('../global-init');
const utils = require('../utils');

const { DataToMarkdownBase, MarkdownToHTML, getFireball, queryDependReposFromAllBranches } = require('./utils');
const { Which, requestFromAllPages } = require('./github');
const server = require('./http-server');

const settings = utils.getSettings();
const title = 'Clean Cocos Creator Issues';

const FIXED_RE = /已经?修复|(?:请|麻烦|下一?个版本)\S*(?:验证|测试|确认|试试|[测|试]看看)/;

class DataToMarkdown extends DataToMarkdownBase {
    constructor (info) {
        super(info);

        this._currentRepo = null;
    }

    _renderChunk (chunk) {
        let { which, issue } = chunk;

        let text = '';
        if (which !== this._currentRepo) {
            text += `### [${which}](${which.url})\n`;
            this._currentRepo = which;
        }
        text += ` - [${issue.title}](${issue.url})`;

        return text;
    }

    _renderHeader (info) {
        return `
# ${title}

\`\`\`
${info}
\`\`\`
`;
    }
}

function isIssueFixed (issue) {
    let nodes = issue.timelineItems.nodes;
    if (nodes.some(x => x.__typename === 'CrossReferencedEvent' && x.source.state === 'OPEN')) {
        return false;
    }
    if (nodes.some(x => x.__typename === 'ReferencedEvent' || x.source.state === 'MERGED')) {
        return true;
    }
    for (let comment of issue.comments.nodes) {
        if (FIXED_RE.test(comment.bodyText)) {
            return true;
        }
    }
    return false;
}

async function queryIssues (which, output) {
    const endTimer = utils.timer(`query issues from ${which}`);

    let query = `query issues($owner: String!, $repo: String!, PageVarDef) {
  repository(owner: $owner, name: $repo) {
    issues(states: OPEN, orderBy: {direction: DESC, field: UPDATED_AT}, PageVar) {
        # filterBy: {since: "2010-03-03T08:54:03Z"}
      nodes {
        title
        url
        timelineItems(last: 50, itemTypes: [REFERENCED_EVENT, CROSS_REFERENCED_EVENT]) {
                    # since: "2010-04-03T08:54:03Z"
          nodes {
            __typename
            ... on CrossReferencedEvent {
              # PR
              source {
                ... on PullRequest {
                  state
                }
              }
            }
            # ... on ReferencedEvent {
            #   # commit event
            #   __typename
            # }
          }
        }
        comments (last: 3) {
          nodes {
            bodyText
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
    await requestFromAllPages(query, variables, res => {
        let connection = res.repository.issues;
        let issues = connection.nodes;
        issues.forEach(issue => {
            if (isIssueFixed(issue)) {
                output.write({ which, issue });
            }
        });
        return connection;
    });

    endTimer();
}

async function gatherData (output) {
    let tasksRepo = new Which(settings.creatorGithub.owner, settings.creatorGithub.tasksRepo);
    let depends = (await queryDependReposFromAllBranches()).repos;
    let repos = [tasksRepo, getFireball()].concat(depends);
    for (let which of repos) {
        await queryIssues(which, output);
    }
}

async function deferredInit (output, toHTML) {
    await utils.sleep();
    server.launch();
    await utils.sleep();
    server.send(toHTML);
    await utils.sleep();
    server.openBrowser();
}

(async function main () {

    // show debug info

    let info = `Output issues that have been referenced by a merged pull request or commit.`;
    const endTimer = utils.timer(info);

    // init streaming

    let output = new DataToMarkdown(info);
    let toHTML = new MarkdownToHTML();
    output.pipe(toHTML);

    // process in sequence and streaming to server

    await Promise.all([
        gatherData(output),
        deferredInit(output, toHTML),
    ]);

    output.end();
    endTimer();
})();
