When you implement, update this existing test too:

backend/scripts/test-security-pr4a-duty-boundary-roles.js

It already checks SystemAdmin role permissions. Add checks there for:

SystemAdmin has org.tree.read
SystemAdmin has tax.setup.read
SystemAdmin has tax.setup.upsert
SystemAdmin has gl.account.read
SystemAdmin does not get gl.account.upsert from PR-73
TaxConfigurationManager exists
TaxConfigurationManager has tax.configuration capability group
TaxConfigurationManager does not have onboarding.company.setup

Also add the new role to the role list inside that test, otherwise it may not be fetched/validated