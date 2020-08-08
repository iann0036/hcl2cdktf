terraform {
  required_version = ">= 0.12.0"
}

provider "aws" {
  region = "us-east-1"
}

locals {
  s3_origin_id = "myS3Origin"
}

resource "aws_instance" "ubuntu" {
  ami               = "ami-0ff8a91507f77f867"
  instance_type     = "t3.nano"
  availability_zone = "us-east-1a"

  network_interface {
    network_interface_id = "something"
    device_index         = 0
  }

  network_interface {
    network_interface_id = "something2"
    device_index         = 1
  }

  credit_specification {
    cpu_credits = "unlimited"
  }

  security_groups = [
    "sg-123",
    "sg-456"
  ]

  tags = {
    Name = "MyInstance"
  }
}

resource "aws_instance" "ubuntu2" {
  ami               = "ami-0ff8a91507f77f867"
  instance_type     = aws_ssm_parameter.ssmdatasource.value
  availability_zone = "us-east-1a"

  tags = {
    Name = "MyInstance2"
  }
}

resource "aws_ssm_parameter" "reftest" {
  name  = "ExampleInstanceId"
  type  = "String"
  value = "${aws_instance.ubuntu.id}"
}

data "aws_ssm_parameter" "ssmdatasource" {
  name = "someinstancetype"
}

output "aws_output" "ssmoutput" {
  value = "someoutput"
}
