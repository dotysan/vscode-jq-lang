#! /usr/bin/env -S jq -srf
#

# Intelligent reduction of wrangler tail --format=json output
# Usage: uv run npx wrangler tail --format=json | jq -f tail.jq

del(.scriptVersion)

| if .diagnosticsChannelEvents == [] then
    del(.diagnosticsChannelEvents)
  else . end
| if .exceptions == [] then del(.exceptions) else . end
| if .logs == [] then del(.logs) else . end

| if .eventTimestamp then
    .eventTimestamp |= (. / 1000 | strftime("%Y-%m-%d %H:%M:%S UTC"))
  else . end
| if .logs then
    .logs |= map(.timestamp |= (. / 1000 | strftime("%Y-%m-%d %H:%M:%S UTC")))
  else . end
| if .event.scheduledTime then
    .event.scheduledTime |= (. / 1000 | strftime("%Y-%m-%d %H:%M:%S UTC"))
  else . end

| if .event.request?.cf then
    .event.request.cf |= (
      del(.tlsClientCiphersSha1, .tlsClientExtensionsSha1,
          .tlsClientExtensionsSha1Le, .tlsClientRandom,
          .tlsExportedAuthenticator)

      | if .requestHeaderNames == {} then del(.requestHeaderNames) else . end
      | if .requestPriority == "" then del(.requestPriority) else . end
      | if .tlsClientAuth.certPresented == "0" then del(.tlsClientAuth) else . end
      | if .tlsCipher == "" then del(.tlsCipher) else . end
      | if .tlsClientHelloLength == "" then del(.tlsClientHelloLength) else . end
      | if .tlsVersion == "" then del(.tlsVersion) else . end
      | if .botManagement.score == 99 then del(.botManagement) else . end
      | if .verifiedBotCategory == "" then del(.verifiedBotCategory) else . end
    )
  else . end
