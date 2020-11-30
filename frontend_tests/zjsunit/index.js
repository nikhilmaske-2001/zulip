"use strict";

const Module = require("module");
const path = require("path");

const Handlebars = require("handlebars/runtime");
const _ = require("lodash");

const handlebars = require("./handlebars");
const stub_i18n = require("./i18n");
const namespace = require("./namespace");
const {make_zblueslip} = require("./zblueslip");

require("@babel/register")({
    extensions: [".es6", ".es", ".jsx", ".js", ".mjs", ".ts"],
    only: [
        new RegExp("^" + _.escapeRegExp(path.resolve(__dirname, "../../static/js") + path.sep)),
        new RegExp(
            "^" + _.escapeRegExp(path.resolve(__dirname, "../../static/shared/js") + path.sep),
        ),
    ],
    plugins: ["rewire-ts"],
});

// Create a helper function to avoid sneaky delays in tests.
function immediate(f) {
    return () => f();
}

// Find the files we need to run.
const files = process.argv.slice(2);
if (files.length === 0) {
    throw new Error("No tests found");
}

// Set up our namespace helpers.
global.window = new Proxy(global, {
    set: (obj, prop, value) => {
        namespace.set_global(prop, value);
        return true;
    },
});
global.to_$ = () => window;

// Set up Handlebars
handlebars.hook_require();

const noop = function () {};

// Set up fake module.hot
Module.prototype.hot = {
    accept: noop,
};

function short_tb(tb) {
    const lines = tb.split("\n");

    const i = lines.findIndex(
        (line) => line.includes("run_test") || line.includes("run_one_module"),
    );

    if (i === -1) {
        return tb;
    }

    return lines.splice(0, i + 1).join("\n") + "\n(...)\n";
}

let current_file_name;

function run_one_module(file) {
    console.info("running test " + path.basename(file, ".js"));
    current_file_name = file;
    require(file);
}

global.run_test = (label, f) => {
    if (files.length === 1) {
        console.info("        test: " + label);
    }
    try {
        namespace.with_overrides(f);
    } catch (error) {
        console.info("-".repeat(50));
        console.info(`test failed: ${current_file_name} > ${label}`);
        console.info();
        throw error;
    }
    // defensively reset blueslip after each test.
    blueslip.reset();
};

try {
    files.forEach((file) => {
        namespace.set_global("location", {
            hash: "#",
        });
        namespace.set_global("setTimeout", noop);
        namespace.set_global("setInterval", noop);
        _.throttle = immediate;
        _.debounce = immediate;

        namespace.set_global("blueslip", make_zblueslip());
        namespace.set_global("i18n", stub_i18n);
        namespace.clear_zulip_refs();

        run_one_module(file);

        if (blueslip.reset) {
            blueslip.reset();
        }

        namespace.restore();
        Handlebars.HandlebarsEnvironment();
    });
} catch (error) {
    if (error.stack) {
        console.info(short_tb(error.stack));
    } else {
        console.info(error);
    }
    process.exit(1);
}
