import type { EntryGroup } from '../../entries';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      {
        label: 'Roles',
        path: '/aws/iam/roles',
        listedBy: 'ListRoles',
      },
      {
        label: 'Policies',
        path: '/aws/iam/policies',
        listedBy: 'ListPolicies',
      },
      {
        label: 'Access keys',
        path: '/aws/iam/access-keys',
        listedBy: 'ListAccessKeys',
      },
      {
        label: 'Account aliases',
        path: '/aws/iam/account-aliases',
        listedBy: 'ListAccountAliases',
      },
      {
        label: 'Attached group policies',
        path: '/aws/iam/attached-group-policies',
        listedBy: 'ListAttachedGroupPolicies',
        listedInside: '/aws/iam/groups',
      },
      {
        label: 'Attached role policies',
        path: '/aws/iam/attached-role-policies',
        listedBy: 'ListAttachedRolePolicies',
        listedInside: '/aws/iam/roles',
        shownIn: {
          entry: '/aws/iam/roles',
          place: '"Permissions policies" in the "Permissions" tab of a role',
        },
      },
      {
        label: 'Attached user policies',
        path: '/aws/iam/attached-user-policies',
        listedBy: 'ListAttachedUserPolicies',
        listedInside: '/aws/iam/users',
      },
      {
        label: 'Delegation requests',
        path: '/aws/iam/delegation-requests',
        listedBy: 'ListDelegationRequests',
      },
      {
        label: 'Group policies',
        path: '/aws/iam/group-policies',
        listedBy: 'ListGroupPolicies',
        listedInside: '/aws/iam/groups',
      },
      {
        label: 'Groups',
        path: '/aws/iam/groups',
        listedBy: 'ListGroups',
      },
      {
        label: 'Instance profiles',
        path: '/aws/iam/instance-profiles',
        listedBy: 'ListInstanceProfiles',
      },
      {
        label: 'MFA devices',
        path: '/aws/iam/mfa-devices',
        listedBy: 'ListMFADevices',
      },
      {
        label: 'OpenID Connect providers',
        path: '/aws/iam/open-id-connect-providers',
        listedBy: 'ListOpenIDConnectProviders',
      },
      {
        label: 'Policy versions',
        path: '/aws/iam/policy-versions',
        listedBy: 'ListPolicyVersions',
        listedInside: '/aws/iam/policies',
        shownIn: {
          entry: '/aws/iam/policies',
          place: 'the "Versions" section of a policy',
        },
      },
      {
        label: 'Role policies',
        path: '/aws/iam/role-policies',
        listedBy: 'ListRolePolicies',
        listedInside: '/aws/iam/roles',
        shownIn: {
          entry: '/aws/iam/roles',
          place: '"Permissions policies" in the "Permissions" tab of a role',
        },
      },
      {
        label: 'SAML providers',
        path: '/aws/iam/saml-providers',
        listedBy: 'ListSAMLProviders',
      },
      {
        label: 'Server certificates',
        path: '/aws/iam/server-certificates',
        listedBy: 'ListServerCertificates',
      },
      {
        label: 'Service specific credentials',
        path: '/aws/iam/service-specific-credentials',
        listedBy: 'ListServiceSpecificCredentials',
      },
      {
        label: 'Signing certificates',
        path: '/aws/iam/signing-certificates',
        listedBy: 'ListSigningCertificates',
      },
      {
        label: 'SSH public keys',
        path: '/aws/iam/ssh-public-keys',
        listedBy: 'ListSSHPublicKeys',
      },
      {
        label: 'User policies',
        path: '/aws/iam/user-policies',
        listedBy: 'ListUserPolicies',
        listedInside: '/aws/iam/users',
      },
      {
        label: 'Users',
        path: '/aws/iam/users',
        listedBy: 'ListUsers',
      },
      {
        label: 'Virtual MFA devices',
        path: '/aws/iam/virtual-mfa-devices',
        listedBy: 'ListVirtualMFADevices',
      },
    ],
  },
];
