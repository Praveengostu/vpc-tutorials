provider "ibm" {
  ibmcloud_api_key = "${var.ibmcloud_api_key}"
  generation       = 1
  ibmcloud_timeout = "${var.ibmcloud_timeout}"
}
