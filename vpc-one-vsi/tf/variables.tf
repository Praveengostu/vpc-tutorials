variable "ibmcloud_api_key" {}

variable "ibmcloud_timeout" {
  description = "Timeout for API operations in seconds."
  default     = 900
}

variable "resource_group_name" {}

variable "vpc_name" {}

variable "basename" {
  description = "Prefix used for all resource names"
}

variable "subnet_zone" {}

variable "ssh_keyname" {}
