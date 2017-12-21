
const { resolve } = require('path');

function getSettings () {
    const defaultsDeep = require('lodash/defaultsDeep');
    const mapValues = require('lodash/mapValues');
    const defaultSettings = require('../package.json').workflows_settings;
    const customSettings = require('../custom_settings');

    // inherit settings
    defaultsDeep(customSettings, defaultSettings);

    // resolve paths
    customSettings.paths = mapValues(customSettings.paths, x => resolve('../custom_settings', x));

    return customSettings;
}

module.exports = {
    getSettings
};
