"""
compute.py
----------
Looks up the latest Windows Server 2022 Full AMI (owned by Amazon) and
provisions the performance-testing EC2 instance.

Instance specification:
  - Type  : c5.xlarge  (Compute Optimised — reduces OS noise on perf tests)
  - OS    : Windows Server 2022 Full Base (required for PDH subsystem)
  - Subnet: public subnet with a public IP assigned automatically

Usage:
    from compute import create_instance
    instance = create_instance(subnet_id, sg_id, userdata_script, tags)
"""

import pulumi
import pulumi_aws as aws

from networking import NetworkOutputs


def create_instance(
    network: NetworkOutputs,
    userdata_script: pulumi.Output,
    tags: dict[str, str],
) -> aws.ec2.Instance:
    """
    Resolve the latest Windows Server 2022 Full AMI, then create the EC2
    instance and return it.
    """

    # ── AMI lookup ────────────────────────────────────────────────────────
    # Windows Server 2022 Full Base — Full edition is required because the
    # PDH (Performance Data Helper) subsystem used by the Datadog
    # windows_performance_counters integration is only available in Full.
    windows_ami = aws.ec2.get_ami(
        most_recent=True,
        owners=["amazon"],
        filters=[
            aws.ec2.GetAmiFilterArgs(
                name="name",
                values=["Windows_Server-2022-English-Full-Base-*"],
            ),
            aws.ec2.GetAmiFilterArgs(
                name="state",
                values=["available"],
            ),
        ],
    )

    # ── EC2 Instance ──────────────────────────────────────────────────────
    instance = aws.ec2.Instance(
        "app-host",
        ami=windows_ami.id,
        instance_type="c5.xlarge",
        subnet_id=network["subnet"].id,
        vpc_security_group_ids=[network["security_group"].id],
        associate_public_ip_address=True,
        # user_data is an Output[str]; Pulumi resolves it before provisioning
        user_data=userdata_script,
        # Ensure the instance is fully replaced (not in-place updated) when
        # user_data changes — critical for idempotent perf runs.
        user_data_replace_on_change=True,
        root_block_device=aws.ec2.InstanceRootBlockDeviceArgs(
            volume_type="gp3",
            volume_size=50,  # GB — Windows 2022 base + Datadog overhead
            encrypted=True,
        ),
        tags={**tags, "Name": "perf-test-app-host"},
    )

    return instance
