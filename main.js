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

function outputMapCdktf(index, resources) {
    var output = '';
    var params = '';
    
    var type = tfToCdktfType(Object.keys(resources[index])[0]);

    var tfvalues = getTfValues(resources[index]);

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

    output += `        const ${getTfName(resources[index]).toLowerCase()} = new ${type}(this, '${getTfName(resources[index])}', ${params});

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

    var region = "us-east-1";
    for (var provider of plandata['provider']) {
        if (Object.keys(provider)[0] == "aws") {
            for (var prop of provider['aws']) {
                if (prop['region']) {
                    region = prop['region'];
                }
            }
        }
    }

    var cdktftypes = [];
    for (var resource of plandata['resource']) {
        cdktftypes.push(tfToCdktfType(Object.keys(resource)[0]));
    }

    var compiled = `import { Construct } from 'constructs';
import { App, TerraformStack, TerraformOutput } from 'cdktf';
import { ${cdktftypes.join(', ')}, AwsProvider } from './.gen/providers/aws';

class MyStack extends TerraformStack {
    constructor(scope: Construct, name: string) {
        super(scope, name);

        new AwsProvider(this, 'aws', {
          region: '${region}'
        });

`;

    for (var i=0; i<plandata['resource'].length; i++) {
        compiled += outputMapCdktf(i, plandata['resource']);
    }

    for (var resource of plandata['resource']) {
        var resourcename = Object.keys(resource[Object.keys(resource)[0]][0])[0];
        compiled += `        new TerraformOutput(this, '${resourcename.toLowerCase()}', {
            value: ${r=resourcename.toLowerCase()}
        });

`;
    }

    compiled += `    }
}

const app = new App();
new MyStack(app, 'my-stack');
app.synth();
`;

    return compiled;
}

function main() {
    commander
        .arguments('<filename>', 'filename of the Terraform plan')
        .option('-o, --output-filename <filename>', 'the filename of the output file')

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
