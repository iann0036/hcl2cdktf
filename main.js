const commander = require('commander');
const fs = require('fs');
const { spawnSync } = require('child_process');

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

function outputMapCdktf(index, resources) {
    var output = '';
    var params = '';
    
    var type = tfToCdktfType(resources[index].type);

    if (Object.keys(resources[index]['values']).length) {
        for (var option in resources[index]['values']) {
            if (typeof resources[index]['values'][option] !== "undefined" && resources[index]['values'][option] !== null) {
                var initialSpacing = 12;
                var optionvalue = processCdktfParameter(resources[index]['values'][option], initialSpacing, index, resources);

                if (typeof optionvalue !== "undefined") {
                    params += `
            ${tfToCdktfProp(option)}: ${optionvalue},`;
                }
            }
        }
    }
    
    params = "{" + params.substring(0, params.length - 1) + `
        }`; // remove last comma

    output += `        const ${resources[index].name.toLowerCase()} = new ${type}(this, '${resources[index].name}', ${params});

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
        /*for (var i = 0; i < resources.length; i++) { // correlate
            if (circularReferenceFound(i, index, 'cdktf')) {
                continue;
            }

            if (resources[i].returnValues && resources[i].returnValues.Terraform) {
                for (var attr_name in resources[i].returnValues.Terraform) {
                    if (resources[i].returnValues.Terraform[attr_name] == param) {
                        return resources[i].logicalId.toLowerCase() + "." + attr_name;
                    }
                }
            }
        }*/

        return param;
    }
    if (typeof param == "string") {
        /*for (var i = 0; i < resources.length; i++) { // correlate
            if (circularReferenceFound(i, index, 'cdktf')) {
                continue;
            }

            if (resources[i].returnValues && resources[i].returnValues.Terraform) {
                for (var attr_name in resources[i].returnValues.Terraform) {
                    if (resources[i].returnValues.Terraform[attr_name] == param) {
                        return resources[i].logicalId.toLowerCase() + "." + attr_name;
                    }
                }
            }
        }*/

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
        throw "Could not determine correct arguments";
    }

    const filedata = fs.readFileSync(args.args[0], {encoding:'utf8', flag:'r'});
    var plandata = {};

    const child = spawnSync('terraform', ['show', '-json', args.args[0]]);

    if (child.error) {
        console.error(child.error.toString());
    }
    if (child.stderr && child.stderr.toString().trim().length > 0) {
        console.error(child.stderr.toString());
    }
    plandata = JSON.parse(child.stdout.toString());

    var region = plandata['configuration']['provider_config']['aws']['expressions']['region']['constant_value'];
    if (!region || region == "") {
        region = "us-east-1";
    }

    var cdktftypes = [];
    for (var resource of plandata['planned_values']['root_module']['resources']) {
        cdktftypes.push(tfToCdktfType(resource.type));
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

    for (var i=0; i<plandata['planned_values']['root_module']['resources'].length; i++) {
        compiled += outputMapCdktf(i, plandata['planned_values']['root_module']['resources']);
    }

    for (var resource of plandata['planned_values']['root_module']['resources']) {
        compiled += `        new TerraformOutput(this, '${resource.name.toLowerCase()}', {
            value: ${resource.name.toLowerCase()}
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
