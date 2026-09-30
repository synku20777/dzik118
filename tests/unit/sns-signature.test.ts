import { createSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isAllowedSigningCertUrl,
  snsStringToSign,
  spkiFromCertificatePem,
  verifySnsSignature,
  type SnsMessage,
} from "../../src/lib/email/sns-signature";
import { TEST_CERT_PEM, TEST_PRIVATE_KEY_PEM } from "./fixtures/sns-test-keys";

const CERT_URL =
  "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-test.pem";

function signed(
  message: SnsMessage,
  version: "1" | "2" = "2",
  privateKey = TEST_PRIVATE_KEY_PEM
): SnsMessage {
  const toSign = snsStringToSign({ ...message, SignatureVersion: version });
  if (toSign === null) throw new Error("not signable");
  const signer = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256");
  signer.update(toSign);
  return {
    ...message,
    SignatureVersion: version,
    SigningCertURL: CERT_URL,
    Signature: signer.sign(privateKey, "base64"),
  };
}

const notification: SnsMessage = {
  Type: "Notification",
  MessageId: "0f9e0b2c-1111-2222-3333-444455556666",
  TopicArn: "arn:aws:sns:eu-central-1:123456789012:ses-invoice-events",
  Message: JSON.stringify({ eventType: "Bounce" }),
  Timestamp: "2026-09-30T12:00:00.000Z",
};
const loadCert = async () => TEST_CERT_PEM;

describe("snsStringToSign", () => {
  it("uses the AWS field order and skips a missing Subject", () => {
    expect(snsStringToSign(notification)).toBe(
      `Message\n${notification.Message}\nMessageId\n${notification.MessageId}\nTimestamp\n${notification.Timestamp}\nTopicArn\n${notification.TopicArn}\nType\nNotification\n`
    );
    expect(snsStringToSign({ ...notification, Subject: "Hi" })).toContain(
      "\nSubject\nHi\nTimestamp\n"
    );
  });

  it("signs confirmations with SubscribeURL and Token", () => {
    const text = snsStringToSign({
      Type: "SubscriptionConfirmation",
      MessageId: "m",
      Message: "msg",
      SubscribeURL:
        "https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription",
      Timestamp: "t",
      Token: "tok",
      TopicArn: "arn",
    });
    expect(text?.startsWith("Message\nmsg\nMessageId\nm\nSubscribeURL\n")).toBe(
      true
    );
    expect(text).toContain(
      "\nToken\ntok\nTopicArn\narn\nType\nSubscriptionConfirmation\n"
    );
  });

  it("returns null for an unknown type or a missing field", () => {
    expect(snsStringToSign({ Type: "Other" })).toBeNull();
    expect(snsStringToSign({ Type: "Notification", Message: "x" })).toBeNull();
  });
});

describe("isAllowedSigningCertUrl", () => {
  it("accepts an SNS certificate address only", () => {
    expect(isAllowedSigningCertUrl(CERT_URL)).toBe(true);
    for (const bad of [
      "http://sns.eu-central-1.amazonaws.com/x.pem",
      "https://sns.eu-central-1.amazonaws.com.evil.com/x.pem",
      "https://evil.com/sns.eu-central-1.amazonaws.com/x.pem",
      "https://user@sns.eu-central-1.amazonaws.com/x.pem",
      "https://sns.eu-central-1.amazonaws.com:8443/x.pem",
      "https://s3.eu-central-1.amazonaws.com/x.pem",
      "https://sns.eu-central-1.amazonaws.com/x.txt",
      "not a url",
    ]) {
      expect(isAllowedSigningCertUrl(bad)).toBe(false);
    }
  });
});

describe("spkiFromCertificatePem", () => {
  it("cuts a usable public key out of a certificate", async () => {
    const spki = spkiFromCertificatePem(TEST_CERT_PEM);
    const key = await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    expect(key.type).toBe("public");
  });
});

describe("verifySnsSignature", () => {
  it("accepts a correctly signed message, both signature versions", async () => {
    expect(await verifySnsSignature(signed(notification, "2"), loadCert)).toBe(
      true
    );
    expect(await verifySnsSignature(signed(notification, "1"), loadCert)).toBe(
      true
    );
  });

  it("rejects a message that changed after signing", async () => {
    const message = signed(notification);
    expect(
      await verifySnsSignature(
        { ...message, Message: JSON.stringify({ eventType: "Complaint" }) },
        loadCert
      )
    ).toBe(false);
    expect(
      await verifySnsSignature({ ...message, TopicArn: "arn:other" }, loadCert)
    ).toBe(false);
  });

  it("rejects a message signed with another key", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = signed(
      notification,
      "2",
      other.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    );
    expect(await verifySnsSignature(forged, loadCert)).toBe(false);
  });

  it("rejects a bad certificate address without fetching it", async () => {
    let fetched = false;
    const result = await verifySnsSignature(
      { ...signed(notification), SigningCertURL: "https://evil.com/cert.pem" },
      async () => {
        fetched = true;
        return TEST_CERT_PEM;
      }
    );
    expect(result).toBe(false);
    expect(fetched).toBe(false);
  });

  it("rejects missing or unsupported fields and broken input", async () => {
    const good = signed(notification);
    expect(
      await verifySnsSignature({ ...good, Signature: undefined }, loadCert)
    ).toBe(false);
    expect(
      await verifySnsSignature({ ...good, SignatureVersion: "3" }, loadCert)
    ).toBe(false);
    expect(
      await verifySnsSignature({ ...good, Signature: "!!!" }, loadCert)
    ).toBe(false);
    expect(
      await verifySnsSignature(
        good,
        async () =>
          "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----"
      )
    ).toBe(false);
    expect(
      await verifySnsSignature(good, async () => {
        throw new Error("network");
      })
    ).toBe(false);
  });
});
