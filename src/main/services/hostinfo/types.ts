export interface RdapInfo { org?: string; asn?: string; country?: string; range?: string }

export interface HostInfo {
  host: string;            // hostname or IP literal extracted from stream_url
  isIpLiteral: boolean;
  port?: string;
  ips: string[];           // DNS A results, or [host] when host is already an IP literal
  ptr?: string;            // reverse-DNS hostname for the primary IP
  rdap?: RdapInfo;
  resolvedAt: string;      // ISO; injected (no Date.now() in the service)
  errors: string[];        // per-lookup failures; partial results still returned
}
