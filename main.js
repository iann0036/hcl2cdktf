#!/usr/bin/env node

const commander = require('commander');
const fs = require('fs');
const HCL = require("js-hcl-parser");

function tfToCdktfProp(str) {
    var split = str.split("_");
    var ret = split.map(x => x[0].toUpperCase() + x.substr(1)).join('');
    return ret[0].toLowerCase() + ret.substr(1);
}

function tfToCdktfType(str) {
    var typesplit = str.split("_");
    typesplit.shift(); // throw away "aws_"
    return typesplit.map(x => x[0].toUpperCase() + x.substr(1)).join('');
}

function getTfValues(resource) {
    return Object.values(Object.values(resource)[0][0])[0][0];
}

function getTfName(resource) {
    return Object.keys(Object.values(resource)[0][0])[0];
}

function outputMapCdktf(index, resources, type, tfvalues, name) {
    var output = '';
    var params = '';

    if (Object.keys(tfvalues).length) {
        for (var option in tfvalues) {
            if (typeof tfvalues[option] !== "undefined" && tfvalues[option] !== null) {
                var initialSpacing = 12;
                var optionvalue = processCdktfParameter(tfvalues[option], initialSpacing, index, resources);

                if (typeof optionvalue !== "undefined") {
                    params += `
            ${tfToCdktfProp(option)}: ${optionvalue},`;
                }
            }
        }
    }

    params = "{" + params.substring(0, params.length - 1) + `
        }`; // remove last comma

    output += `        const ${name.toLowerCase()} = new ${tfToCdktfType(type)}(this, '${name}', ${params});

`;

    return output;
}

function processCdktfParameter(param, spacing, index, resources) {
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
            return param.substring(param.indexOf(".") + 1, param.length - 1);
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
            paramitems.push(processCdktfParameter(paramitem, spacing + 4, index, resources));
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

        Object.keys(param).forEach(function (key) {
            var subvalue = processCdktfParameter(param[key], spacing + 4, index, resources);
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

        return `[{
` + ' '.repeat(spacing + 4) + paramitems.join(`,
` + ' '.repeat(spacing + 4)) + `
` + ' '.repeat(spacing) + `}]`;
    }

    return undefined;
}

function convert(args) {
    if (!args || !args.args || !args.args[0]) {
        commander.help();
        process.exit(0);
    }

    const filedata = fs.readFileSync(args.args[0], {encoding:'utf8', flag:'r'});
    const plandata = JSON.parse(HCL.parse(filedata));

    var isHcl2 = false;
    if (!Array.isArray(plandata.resource)) {
        isHcl2 = true;
    }

    var compiled = args.bare ? '' : `import { Construct } from 'constructs';
import { App, TerraformStack, TerraformOutput } from 'cdktf';`;

    var cdktftypes = {};
    if (isHcl2) {
        for (var resourcetype of Object.keys(plandata['resource'])) { // TODO: providers without resources not captured
            var provider = resourcetype.split("_")[0];
            if (!cdktftypes[provider]) {
                cdktftypes[provider] = [];
            }
            cdktftypes[provider].push(tfToCdktfType(resourcetype));
            cdktftypes[provider] = [...new Set(cdktftypes[provider])]; // dedup
        }
    } else {
        for (var resource of plandata['resource']) {
            var provider = Object.keys(resource)[0].split("_")[0];
            if (!cdktftypes[provider]) {
                cdktftypes[provider] = [];
            }
            cdktftypes[provider].push(tfToCdktfType(Object.keys(resource)[0]));
            cdktftypes[provider] = [...new Set(cdktftypes[provider])]; // dedup
        }
    }

    if (!args.bare) {
        for (var provider of Object.keys(cdktftypes)) {
            compiled += `
import { ${cdktftypes[provider].join(', ')}, ${tfToCdktfType("_" + provider)}Provider } from './.gen/providers/${provider}';`;
        }

        compiled += `

class MyStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
        super(scope, name);

`;
    }

    if (plandata['provider']) {
        var region = 'us-east-1';
        if (isHcl2) {
            for (var providername of Object.keys(plandata['provider'])) {
                compiled += `        new ${tfToCdktfType("_" + providername)}Provider(this, '${providername}', {
                ${Object.keys(plandata['provider'][providername]).map(prop => `${prop}: "${plandata['provider'][providername][prop]}"`).join(`,
                `)}
            });

    `; // TODO: Test multi-level and a_b props
            }
        } else {
            for (var provider of plandata['provider']) {
                for (var providername of Object.keys(provider)) {
                    compiled += `        new ${tfToCdktfType("_" + providername)}Provider(this, '${providername}', {
                ${Object.keys(provider[providername][0]).map(prop => `${prop}: "${provider[providername][0][prop]}"`).join(`,
                `)}
            });

    `; // TODO: Test multi-level and a_b props
                }
            }
        }
    }

    if (isHcl2) {
        var i = 0;
        for (var type of Object.keys(plandata['resource'])) {
            for (var name of Object.keys(plandata['resource'][type])) {
                compiled += outputMapCdktf(i, plandata['resource'], type, plandata['resource'][type][name], name);
                i += 1;
            }
        }
    } else {
        for (var i = 0; i < plandata['resource'].length; i++) {
            var type = Object.keys(plandata['resource'][i])[0];
            var tfvalues = getTfValues(plandata['resource'][i]);
            var name = getTfName(plandata['resource'][i]);

            compiled += outputMapCdktf(i, plandata['resource'], type, tfvalues, name);
        }
    }

    if (!args.bare) {
        if (isHcl2) {
            for (var resourcegroup of Object.values(plandata['resource'])) {
                for (var resourcename of Object.keys(resourcegroup)) {
                    compiled += `        new TerraformOutput(this, '${resourcename.toLowerCase()}', {
                value: ${r = resourcename.toLowerCase()}
            });

        `;
                }
            }
        } else {
            for (var resource of plandata['resource']) {
                var resourcename = Object.keys(resource[Object.keys(resource)[0]][0])[0];
                compiled += `        new TerraformOutput(this, '${resourcename.toLowerCase()}', {
                    value: ${r = resourcename.toLowerCase()}
                });

        `;
            }
        }
    }

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
        .option('-b, --bare', 'Omit boilerplate like imports and class generation')

    const args = commander.parse(process.argv);

    const template = convert(args);

    if (args.outputFilename) {
        fs.writeFileSync(args.outputFilename, template);
    } else {
        console.log(template);
    }
}

if (require.main === module) {
    main();
}
