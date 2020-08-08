# hcl2cdktf

<span class="badge-npmversion"><a href="https://npmjs.org/package/hcl2cdktf" title="View this project on NPM"><img src="https://img.shields.io/npm/v/hcl2cdktf.svg" alt="NPM version" /></a></span>

> Converts HCL to Terraform CDK

## Installation

```
npm i -g hcl2cdktf
```

## Usage

You should specify a Terraform file for processing:

```
hcl2cdktf test.tf
```

To output to a specific file instead of to stdout:

```
hcl2cdktf test.tf -o mycdktf.ts
```

#### -o, --output-filename &lt;filename&gt;

(Optional) The filename of the output file

#### -b, --bare

(Optional) Omit boilerplate like imports and class generation

## Supported Features

- [x] HCL1 & HCL2
- [x] Resources
- [x] Data Sources
- [x] Outputs
- [x] Attribute referencing
