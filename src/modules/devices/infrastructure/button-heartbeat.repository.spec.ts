import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { FIREBASE_FIRESTORE } from "@/infra/firebase/firebase.constants";
import { DeviceRepository } from "./devices.repository";

describe("DeviceRepository.recordButtonHeartbeat", () => {
  const reference = {};
  const transaction = { get: jest.fn(), update: jest.fn() } satisfies Pick<
    Transaction,
    "get" | "update"
  >;
  const firestore = {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  } satisfies Pick<Firestore, "collection" | "runTransaction">;
  let repository: DeviceRepository;
  let document: Record<string, unknown>;
  beforeEach(async () => {
    jest.resetAllMocks();
    document = {
      deviceId: "BUT-111-AAA",
      deviceType: "button",
      deviceSecretHash: "verified-hash",
      assignedUserId: "owner-a",
    };
    firestore.collection.mockReturnValue({
      doc: jest.fn().mockReturnValue(reference),
    });
    transaction.get.mockImplementation(async () => ({
      exists: true,
      data: () => document,
    }));
    firestore.runTransaction.mockImplementation(async (work) =>
      work(transaction),
    );
    const module = await Test.createTestingModule({
      providers: [
        DeviceRepository,
        { provide: FIREBASE_FIRESTORE, useValue: firestore },
      ],
    }).compile();
    repository = module.get(DeviceRepository);
  });
  it("writes server timestamps without changing ownership, activation or camera state", async () => {
    await repository.recordButtonHeartbeat("BUT-111-AAA", "verified-hash");
    expect(transaction.update).toHaveBeenCalledWith(reference, {
      lastSeenAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  it("rejects a secret rotated between credential verification and the transaction", async () => {
    document.deviceSecretHash = "rotated-hash";
    await expect(
      repository.recordButtonHeartbeat("BUT-111-AAA", "verified-hash"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.update).not.toHaveBeenCalled();
  });
  it("does not recreate a device deleted while the request was in flight", async () => {
    transaction.get.mockResolvedValue({ exists: false });
    await expect(
      repository.recordButtonHeartbeat("BUT-111-AAA", "verified-hash"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.update).not.toHaveBeenCalled();
  });
});
