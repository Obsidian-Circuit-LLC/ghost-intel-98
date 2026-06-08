/*
 * DCS98 ML-KEM-1024 helper — the native sidecar the chat handshake's KEM leg delegates to.
 * Links AWS-LC's libcrypto (production: the FIPS-validated module build; FIPS power-on self-test runs
 * at library init). Speaks a tiny length-prefixed binary protocol over stdin/stdout; the client is
 * src/main/services/mlkem-sidecar.ts. No sockets, no files, no network — pure stdio.
 *
 *   request  = op(1) | len(4 BE) | payload
 *     1 keygen      payload: (none)
 *     2 encapsulate payload: peerPublic(1568)
 *     3 decapsulate payload: ciphertext(1568) | secretKey(3168)
 *   response = status(1) | len(4 BE) | payload
 *     0 OK   keygen-> pub(1568)|sk(3168); encap-> ct(1568)|ss(32); decap-> ss(32)
 *     1 ERR  payload: ascii reason
 */
#include <openssl/evp.h>
#include <openssl/nid.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MLKEM_NID   NID_MLKEM1024
#define PUB_LEN     1568
#define SEC_LEN     3168
#define CT_LEN      1568
#define SS_LEN      32
#define MAX_PAYLOAD (CT_LEN + SEC_LEN) /* decap input is the largest request payload */

static int read_full(uint8_t *buf, size_t n) {
  size_t got = 0;
  while (got < n) {
    ssize_t r = read(STDIN_FILENO, buf + got, n - got);
    if (r == 0) return 0;                       /* EOF */
    if (r < 0) { if (errno == EINTR) continue; return -1; }
    got += (size_t)r;
  }
  return 1;
}

static int write_full(const uint8_t *buf, size_t n) {
  size_t put = 0;
  while (put < n) {
    ssize_t w = write(STDOUT_FILENO, buf + put, n - put);
    if (w < 0) { if (errno == EINTR) continue; return -1; }
    put += (size_t)w;
  }
  return 1;
}

/* Returns 0 if a response was written, -1 if the stdout write failed (caller should exit). */
static int respond(uint8_t status, const uint8_t *payload, uint32_t len) {
  uint8_t hdr[5];
  hdr[0] = status;
  hdr[1] = (uint8_t)(len >> 24); hdr[2] = (uint8_t)(len >> 16);
  hdr[3] = (uint8_t)(len >> 8);  hdr[4] = (uint8_t)len;
  if (write_full(hdr, 5) != 1) return -1;
  if (len && write_full(payload, len) != 1) return -1;
  return 0;
}

static int fail(const char *msg) { return respond(1, (const uint8_t *)msg, (uint32_t)strlen(msg)); }

static int do_keygen(void) {
  int rc;
  EVP_PKEY *pkey = NULL;
  uint8_t out[PUB_LEN + SEC_LEN];
  size_t publen = PUB_LEN, seclen = SEC_LEN;
  EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_KEM, NULL);
  if (!ctx) return fail("ctx_new_id");
  if (EVP_PKEY_CTX_kem_set_params(ctx, MLKEM_NID) <= 0) { rc = fail("set_params"); goto done; }
  if (EVP_PKEY_keygen_init(ctx) <= 0) { rc = fail("keygen_init"); goto done; }
  if (EVP_PKEY_keygen(ctx, &pkey) <= 0) { rc = fail("keygen"); goto done; }
  if (EVP_PKEY_get_raw_public_key(pkey, out, &publen) <= 0 || publen != PUB_LEN) { rc = fail("get_pub"); goto done; }
  if (EVP_PKEY_get_raw_private_key(pkey, out + PUB_LEN, &seclen) <= 0 || seclen != SEC_LEN) { rc = fail("get_sec"); goto done; }
  rc = respond(0, out, PUB_LEN + SEC_LEN);
done:
  if (pkey) EVP_PKEY_free(pkey);
  EVP_PKEY_CTX_free(ctx);
  return rc;
}

static int do_encap(const uint8_t *payload, uint32_t len) {
  int rc;
  uint8_t out[CT_LEN + SS_LEN];
  size_t ctlen = CT_LEN, sslen = SS_LEN;
  EVP_PKEY_CTX *ctx = NULL;
  EVP_PKEY *pkey;
  if (len != PUB_LEN) return fail("bad_pub_len");
  pkey = EVP_PKEY_kem_new_raw_public_key(MLKEM_NID, payload, PUB_LEN);
  if (!pkey) return fail("new_pub");
  ctx = EVP_PKEY_CTX_new(pkey, NULL);
  if (!ctx) { rc = fail("ctx_new"); goto done; }
  if (EVP_PKEY_encapsulate(ctx, out, &ctlen, out + CT_LEN, &sslen) <= 0 || ctlen != CT_LEN || sslen != SS_LEN) { rc = fail("encap"); goto done; }
  rc = respond(0, out, CT_LEN + SS_LEN);
done:
  if (ctx) EVP_PKEY_CTX_free(ctx);
  EVP_PKEY_free(pkey);
  return rc;
}

static int do_decap(const uint8_t *payload, uint32_t len) {
  int rc;
  uint8_t ss[SS_LEN];
  size_t sslen = SS_LEN;
  EVP_PKEY_CTX *ctx = NULL;
  EVP_PKEY *pkey;
  if (len != CT_LEN + SEC_LEN) return fail("bad_decap_len");
  pkey = EVP_PKEY_kem_new_raw_secret_key(MLKEM_NID, payload + CT_LEN, SEC_LEN);
  if (!pkey) return fail("new_sec");
  ctx = EVP_PKEY_CTX_new(pkey, NULL);
  if (!ctx) { rc = fail("ctx_new"); goto done; }
  if (EVP_PKEY_decapsulate(ctx, ss, &sslen, payload, CT_LEN) <= 0 || sslen != SS_LEN) { rc = fail("decap"); goto done; }
  rc = respond(0, ss, SS_LEN);
done:
  if (ctx) EVP_PKEY_CTX_free(ctx);
  EVP_PKEY_free(pkey);
  return rc;
}

int main(void) {
  uint8_t hdr[5];
  uint8_t payload[MAX_PAYLOAD];
  for (;;) {
    int r = read_full(hdr, 5);
    if (r == 0) break;          /* clean EOF — parent closed stdin */
    if (r < 0) return 1;
    uint8_t op = hdr[0];
    uint32_t len = ((uint32_t)hdr[1] << 24) | ((uint32_t)hdr[2] << 16) | ((uint32_t)hdr[3] << 8) | (uint32_t)hdr[4];
    if (len > MAX_PAYLOAD) return 1;            /* framing can't be recovered — fail closed (exit) */
    if (len && read_full(payload, len) != 1) return 1;
    int rc;
    switch (op) {
      case 1: rc = do_keygen(); break;
      case 2: rc = do_encap(payload, len); break;
      case 3: rc = do_decap(payload, len); break;
      default: rc = fail("bad_op"); break;
    }
    if (rc < 0) return 1;        /* stdout write failed → exit */
  }
  return 0;
}
