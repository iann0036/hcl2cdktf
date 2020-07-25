# hcl2cdktf [WORK IN PROGRESS]

<span class="badge-npmversion"><a href="https://npmjs.org/package/hcl2cdktf" title="View this project on NPM"><img src="https://img.shields.io/npm/v/hcl2cdktf.svg" alt="NPM version" /></a></span>

> Converts HCL to Terraform CDK

## Installation

```
npm i -g hcl2cdktf
```

## Usage

You should specify a Terraform file for processing:

```
hcl2cdktf myplanfile.tf
```

To output to a specific file instead of to stdout:

```
hcl2cdktf myplanfile.tf -o mycdktf.ts
```

#### -o, --output-filename &lt;filename&gt;

(Optional) The filename of the output file
