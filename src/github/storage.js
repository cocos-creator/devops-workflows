
// Use an independent repo to storage data

const { Which, queryText, commit } = require('./github');
const utils = require('../utils');
// const { join } = require('path');

const DIR = '.data-storage/';

// read settings

const settings = utils.getSettings();
const repo = settings.creatorGithub.storageRepo;
const owner = settings.creatorGithub.owner;

const which = new Which(owner, repo, 'master');

const loaded = Object.create(null);

exports.get = async function (name) {
    let cache = loaded[name];
    if (cache) {
        return cache;
    }
    let path = DIR + name + '.json';
    let text = await queryText(which, path);
    let res;
    if (text === '') {
        res = {};
    }
    else {
        res = JSON.parse(text);
    }
    loaded[name] = res;
    return res;
};

exports.save = async function (name, json) {
    if (!json) {
        json = loaded[name];
        if (!json) {
            throw `Can not save storage ${name}, data not supplied.`;
        }
    }
    let path = DIR + name + '.json';
    let text = JSON.stringify(json, null, 2);
    let message = `storage: update ${name}`;
    await commit(which, path, new Buffer(text), message);
};
