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
import pulumi_tls as tls

from networking import NetworkOutputs


def create_key_pair(public_key: str, tags: dict[str, str]) -> aws.ec2.KeyPair:
    """Create an AWS EC2 key pair from an OpenSSH-format public key."""

    return aws.ec2.KeyPair(
        "app-host-keypair",
        public_key=public_key,
        tags={**tags, "Name": "perf-test-app-host-keypair"},
    )


def create_generated_key_pair(
    tags: dict[str, str],
) -> tuple[aws.ec2.KeyPair, pulumi.Output[str]]:
    """Generate a fresh key pair for the stack and return the AWS resource plus private key PEM."""

    private_key = tls.PrivateKey(
        "app-host-private-key",
        algorithm="RSA",
        rsa_bits=4096,
    )

    key_pair = aws.ec2.KeyPair(
        "app-host-keypair",
        public_key=private_key.public_key_openssh,
        tags={**tags, "Name": "perf-test-app-host-keypair"},
    )

    return key_pair, private_key.private_key_pem


def create_instance(
    network: NetworkOutputs,
    userdata_script: pulumi.Output,
    tags: dict[str, str],
    key_name: pulumi.Input[str] | None = None,
    iam_instance_profile: pulumi.Input[str] | None = None,
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
        key_name=key_name,
        iam_instance_profile=iam_instance_profile,
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
