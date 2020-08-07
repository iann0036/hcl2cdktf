const fs = require('fs')
const path = require('path')
const hcl2cdktf = require('../main')

test('generate a cloudfront distribution resource', async () => {
  const hcl = fs.readFileSync(path.join(__dirname, 'fixtures', 'aws_cloudfront_distribution.tf'), 'utf-8');
  const ts = hcl2cdktf.convert(hcl);
  expect(ts).toMatchSnapshot();
});