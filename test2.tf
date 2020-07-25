terraform {
  required_version = ">= 0.11.0"
}

provider "aws" {
  region = "us-east-1"
  a = "b"
  c = "d"
}

provider "dnssimple" {
  region = "us-east-1"
  a = "b"
  c = "d"
}

resource "aws_instance" "ubuntu" {
  ami               = "ami-0ff8a91507f77f867"
  instance_type     = "t3.nano"
  availability_zone = "us-east-1a"

  tags = {
    Name = "MyInstance"
  }
}

resource "aws_instance" "ubuntu2" {
  ami               = "ami-0ff8a91507f77f867"
  instance_type     = "t3.nano"
  availability_zone = "us-east-1a"

  tags = {
    Name = "MyInstance2"
  }
}

resource "aws_ssm_parameter" "reftest" {
  name  = "ExampleInstanceId"
  type  = "String"
  value = aws_instance.ubuntu.id
}

