#!/usr/bin/env node

const commander = require('commander');
const fs = require('fs');
const HCL = require("js-hcl-parser");

var tracked_references = [];
var consumed_references = [];

function tfToCdktfProp(str) {
    var split = str.split("_");
    var ret = split.map(x => x[0].toUpperCase() + x.substr(1)).join('');
    return ret[0].toLowerCase() + ret.substr(1);
}

function tfToCdktfType(str, isDataSource) {
    var typesplit = str.split("_");
    if (!isDataSource) {
        typesplit.shift(); // throw away "aws_"
    }
    return typesplit.map(x => x[0].toUpperCase() + x.substr(1)).join('');
}

function getTfValues(resource) {
    return Object.values(Object.values(resource)[0][0])[0][0];
}

function getTfName(resource) {
    return Object.keys(Object.values(resource)[0][0])[0];
}

function outputMapCdktf(index, resources, type, tfvalues, name, datatype) {
    var output = '';
    var params = '';

    if (Object.keys(tfvalues).length) {
        for (var option in tfvalues) {
            if (typeof tfvalues[option] !== "undefined" && tfvalues[option] !== null) {
                var initialSpacing = 12;
                var optionvalue = processCdktfParameter(tfvalues[option], initialSpacing, index, resources, false);

                if (typeof optionvalue !== "undefined") {
                    if (['locals'].includes(datatype)) {
                        params += `
            ${option}: ${optionvalue},`;
                    } else {
                        params += `
            ${tfToCdktfProp(option)}: ${optionvalue},`;
                    }
                }
            }
        }
    }

    params = "{" + params.substring(0, params.length - 1) + `
        }`; // remove last comma

    if (datatype == 'output') {
        output += `        new TerraformOutput(this, '${name}', ${params});

`;
    } else if (datatype == 'resource' || datatype == 'data') {
        tracked_references.push(name.toLowerCase());
        output += `        const ${name.toLowerCase()} = new ${datatype == 'data' ? 'Data' : ''}${tfToCdktfType(type, (datatype == 'data'))}(this, '${name}', ${params});

`;
    } else {
        output += `        this.addOverride('${datatype}', ${params});

`;
    }

    return output;
}

function processCdktfParameter(param, spacing, index, resources, inArray) {
    var paramitems = [];

    if (param === undefined || param === null || (Array.isArray(param) && param.length == 0))
        return undefined;
    if (typeof param == "boolean") {
        if (param)
            return 'true';
        return 'false';
    }
    if (typeof param == "number") {
        return param;
    }
    if (typeof param == "string") {
        if (param.startsWith("${") && param.endsWith("}")) { // refs
            var first_dot = param.indexOf(".");
            var second_dot = param.indexOf(".", first_dot + 1);
            if (second_dot == -1) {
                return `"${param}"`;
            }

            if (tracked_references.includes(param.substring(first_dot + 1, second_dot))) { // only if reference has been previously seen
                consumed_references.push(param.substring(first_dot + 1, second_dot));
                return param.substring(first_dot + 1, second_dot) + tfToCdktfProp(param.substring(second_dot, param.length - 1)) + "!"; // non-nullable handle
            } else {
                throw "UnseenReference";
            }
        }

        var string_return = param;

        if (string_return.includes("\n")) {
            string_return = "\`\n" + string_return + "\n\`";
            return string_return;
        }

        string_return = param.replace(/\"/g, `\\"`);

        return `"${string_return}"`;
    }
    if (Array.isArray(param)) {
        if (param.length == 0) {
            return '[]';
        }

        param.forEach(paramitem => {
            paramitems.push(processCdktfParameter(paramitem, spacing + 4, index, resources, true));
        });

        return `[
` + ' '.repeat(spacing + 4) + paramitems.join(`,
` + ' '.repeat(spacing + 4)) + `
` + ' '.repeat(spacing) + `]`;
    }
    if (typeof param == "object") {
        if (Object.keys(param).length === 0 && param.constructor === Object) {
            return "{}";
        }

        var isLikelyAttrAsBlock = false; // https://www.terraform.io/docs/configuration/attr-as-blocks.html , https://github.com/iann0036/hcl2cdktf/issues/4#issuecomment-670814681

        Object.keys(param).forEach(function (key) {
            if (key[0] == key[0].toUpperCase()) {
                isLikelyAttrAsBlock = true;
            }

            var subvalue = processCdktfParameter(param[key], spacing + 4, index, resources, false);
            if (typeof subvalue !== "undefined") {
                if (subvalue[0] == '{') {
                    paramitems.push(tfToCdktfProp(key) + ": " + subvalue);
                } else {
                    if (key.match(/^[0-9]+$/g)) {
                        key = "\"" + key + "\"";
                    }
                    paramitems.push(tfToCdktfProp(key) + ": " + subvalue);
                }
            }
        });

        if (isLikelyAttrAsBlock && !inArray) { // reprocess ignoring case changes if likely an attribute block
            paramitems = [];
            Object.keys(param).forEach(function (key) {
                var subvalue = processCdktfParameter(param[key], spacing + 4, index, resources, false);
                if (typeof subvalue !== "undefined") {
                    if (subvalue[0] == '{') {
                        paramitems.push(key + ": " + subvalue);
                    } else {
                        if (key.match(/^[0-9]+$/g)) {
                            key = "\"" + key + "\"";
                        }
                        paramitems.push(key + ": " + subvalue);
                    }
                }
            });
        }

        if (isLikelyAttrAsBlock || inArray) {
            return `{
` + ' '.repeat(spacing + 4) + paramitems.join(`,
` + ' '.repeat(spacing + 4)) + `
` + ' '.repeat(spacing) + `}`;
        }

        return `[{
` + ' '.repeat(spacing + 4) + paramitems.join(`,
` + ' '.repeat(spacing + 4)) + `
` + ' '.repeat(spacing) + `}]`;
    }

    return undefined;
}

function convert(filedata, args) {
    const plandata = JSON.parse(HCL.parse(filedata));

    var isHcl2 = false;
    if (!Array.isArray(plandata.resource)) {
        isHcl2 = true;
    }

    // section: header
    var compiled = args.bare ? '' : `import { Construct } from 'constructs';
import { App, TerraformStack${plandata['output'] ? ', TerraformOutput' : ''} } from 'cdktf';`;

    var cdktftypes = {};
    if (isHcl2) {
        if (plandata['data']) {
            for (var resourcetype of Object.keys(plandata['data'])) { // TODO: providers without resources not captured
                var provider = resourcetype.split("_")[0];
                if (!cdktftypes[provider]) {
                    cdktftypes[provider] = [];
                }
                cdktftypes[provider].push('Data' + tfToCdktfType(resourcetype, true));
                cdktftypes[provider] = [...new Set(cdktftypes[provider])]; // dedup
            }
        }
        if (plandata['resource']) {
            for (var resourcetype of Object.keys(plandata['resource'])) { // TODO: providers without resources not captured
                var provider = resourcetype.split("_")[0];
                if (!cdktftypes[provider]) {
                    cdktftypes[provider] = [];
                }
                cdktftypes[provider].push(tfToCdktfType(resourcetype, false));
                cdktftypes[provider] = [...new Set(cdktftypes[provider])]; // dedup
            }
        }
    } else {
        if (plandata['data']) {
            for (var resource of plandata['data']) {
                var provider = Object.keys(resource)[0].split("_")[0];
                if (!cdktftypes[provider]) {
                    cdktftypes[provider] = [];
                }
                cdktftypes[provider].push('Data' + tfToCdktfType(Object.keys(resource)[0], true));
                cdktftypes[provider] = [...new Set(cdktftypes[provider])]; // dedup
            }
        }
        if (plandata['resource']) {
            for (var resource of plandata['resource']) {
                var provider = Object.keys(resource)[0].split("_")[0];
                if (!cdktftypes[provider]) {
                    cdktftypes[provider] = [];
                }
                cdktftypes[provider].push(tfToCdktfType(Object.keys(resource)[0], false));
                cdktftypes[provider] = [...new Set(cdktftypes[provider])]; // dedup
            }
        }
    }

    if (!args.bare) {
        for (var provider of Object.keys(cdktftypes)) {
            compiled += `
import { ${cdktftypes[provider].join(', ')}, ${tfToCdktfType("_" + provider, false)}Provider } from './.gen/providers/${provider}';`;
        }

        compiled += `

class MyStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
        super(scope, name);

`;
    }

    // section: providers
    if (plandata['provider']) {
        var region = 'us-east-1';
        if (isHcl2) {
            for (var providername of Object.keys(plandata['provider'])) {
                compiled += `        new ${tfToCdktfType("_" + providername, false)}Provider(this, '${providername}', {
            ${Object.keys(plandata['provider'][providername]).map(prop => `${prop}: "${plandata['provider'][providername][prop]}"`).join(`,
            `)}
        });

`; // TODO: Test multi-level and a_b props
            }
        } else {
            for (var provider of plandata['provider']) {
                for (var providername of Object.keys(provider)) {
                    compiled += `        new ${tfToCdktfType("_" + providername, false)}Provider(this, '${providername}', {
            ${Object.keys(provider[providername][0]).map(prop => `${prop}: "${provider[providername][0][prop]}"`).join(`,
            `)}
        });

`; // TODO: Test multi-level and a_b props
                }
            }
        }
    }

    compiledOutputs = [];

    // section: locals (and any other escape hatches)
    for (var datatype of ['locals']) {
        if (plandata[datatype]) {
            if (isHcl2) {
                //compiled += outputMapCdktf(0, plandata[datatype], datatype, plandata[datatype], '', datatype);
                compiledOutputs.push([0, plandata[datatype], datatype, plandata[datatype], '', datatype]);
            } // ignores HCL1
        }
    }

    // section: data sources, resources, outputs
    for (var datatype of ['data', 'resource', 'output']) {
        if (plandata[datatype]) {
            if (isHcl2) {
                var i = 0;
                for (var type of Object.keys(plandata[datatype])) {
                    for (var name of Object.keys(plandata[datatype][type])) {
                        //compiled += outputMapCdktf(i, plandata[datatype], type, plandata[datatype][type][name], name, datatype);
                        compiledOutputs.push([i, plandata[datatype], type, plandata[datatype][type][name], name, datatype]);
                        i += 1;
                    }
                }
            } else {
                for (var i = 0; i < plandata[datatype].length; i++) {
                    var type = Object.keys(plandata[datatype][i])[0];
                    var tfvalues = getTfValues(plandata[datatype][i]);
                    var name = getTfName(plandata[datatype][i]);

                    //compiled += outputMapCdktf(i, plandata[datatype], type, tfvalues, name, datatype);
                    compiledOutputs.push([i, plandata[datatype], type, tfvalues, name, datatype]);
                }
            }
        }
    }

    var attempts = Math.pow(compiledOutputs.length, 2);
    while (compiledOutputs.length && attempts > 0) {
        var outputArgs = compiledOutputs.shift();

        try {
            compiled += outputMapCdktf(...outputArgs);
        } catch (err) {
            if (err == "UnseenReference") {
                compiledOutputs.push(outputArgs);
            } else {
                throw err;
            }
        }

        attempts -= 1;
    }
    if (compiledOutputs.length) {
        console.error("Found circular dependency:");
        console.log(compiledOutputs);
        throw "CircularDependency";
    }

    // remove unused references
    if (!args.bare) {
        for (var ref of tracked_references) {
            if (!consumed_references.includes(ref)) {
                compiled = compiled.replace(`
        const ${ref} = `, `
        `);
            }
        }
    }

    // section: footer
    if (!args.bare) {
        compiled += `    }
}

const app = new App();
new MyStack(app, 'my-stack');
app.synth();
`;
    }

    return compiled;
}

function main() {
    commander
        .arguments('<filename>', 'filename of the Terraform plan')
        .option('-o, --output-filename <filename>', 'the filename of the output file')
        .option('-b, --bare', 'omit boilerplate like imports and class generation')

    const args = commander.parse(process.argv);

    if (!args || !args.args || !args.args[0]) {
        commander.help();
        process.exit(0);
    }
    const filedata = fs.readFileSync(args.args[0], { encoding: 'utf8', flag: 'r' });
    const template = convert(filedata, args);

    if (args.outputFilename) {
        fs.writeFileSync(args.outputFilename, template);
    } else {
        console.log(template);
    }
}

if (require.main === module) {
    main();
}

module.exports.convert = convert;
