const debug = require('debug')
const log = debug('ipfs-companion:proxy')
log.error = debug('ipfs-companion:proxy:error')

const { inCommandWhitelist, createCommandWhitelistError } = require('./pre-command')
const { createProxyAclError } = require('./pre-acl')

// Artificial API command responsible for backend orchestration
// during window.ipfs.enable()
function createEnableCommand (getIpfs, getState, getScope, accessControl, requestAccess) {
  return async (opts) => {
    const scope = await getScope()
    const state = getState()
    log(`received window.ipfs.enable request from ${scope}`, opts)

    // Check if access to the IPFS node is disabled
    if (!state.ipfsProxy || !state.activeIntegrations(scope)) throw new Error('User disabled access to API proxy in IPFS Companion')

    // NOOP if .enable() was called without any arguments
    if (!opts) return

    // Validate and prompt for any missing permissions in bulk
    // if a list of needed commands is announced up front
    if (opts.commands) {
      const missingAcls = []
      const deniedAcls = []
      for (const command of opts.commands) {
        // Fail fast if command is not allowed to be proxied at all
        if (!inCommandWhitelist(command)) {
          throw createCommandWhitelistError(command)
        }
        // Get the current access flag to decide if it should be added
        // to the list of permissions to be prompted about in the next step
        const access = await accessControl.getAccess(scope, command)
        if (!access) {
          missingAcls.push(command)
        } else if (access.allow !== true) {
          deniedAcls.push(command)
        }
      }
      // Fail fast if user already denied any of requested permissions
      if (deniedAcls.length) {
        throw createProxyAclError(scope, deniedAcls)
      }
      // Display a single prompt with all missing permissions
      if (missingAcls.length) {
        const { allow, wildcard } = await requestAccess(scope, missingAcls)
        const access = await accessControl.setAccess(scope, wildcard ? '*' : missingAcls, allow)
        if (!access.allow) {
          throw createProxyAclError(scope, missingAcls)
        }
      }
    }
  }
}

module.exports = createEnableCommand
