import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  UnauthorizedException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { PinoLogger } from "nestjs-pino";
import { Device, DeviceType, DeviceStatus } from "./domain/device.entity";
import { DevicesService } from "./devices.service";
import { DevicesController } from "./devices.controller";
import { DeviceTokenService } from "./device-token.service";
import { DeviceRepository } from "./infrastructure/devices.repository";
import { PhoneCameraService } from "./phone-camera.service";
import { hashDeviceSecret } from "./infrastructure/device-secret";
import { AuthService } from "../auth/auth.service";
import { FirebaseAuthGuard } from "../auth/guards/firebase-auth.guard";
import { ResponseInterceptor } from "@/common/interceptors/response.interceptor";

const secret = "fixture-device-secret";
const now = Date.parse("2026-10-29T12:00:00Z");
function button(id = "BUT-111-AAA", lastSeenAt?: Date) {
  return Device.reconstitute({
    deviceId: id,
    deviceType: DeviceType.BUTTON,
    status: DeviceStatus.PROVISIONED,
    assignedUserId: "owner-a",
    deviceSecretHash: hashDeviceSecret(secret),
    lastSeenAt,
  });
}

describe("button presence", () => {
  let module: TestingModule;
  let app: INestApplication;
  let service: DevicesService;
  const repository = {
    findDevicesByAssignedUser: jest.fn(),
    findDeviceById: jest.fn(),
    recordButtonHeartbeat: jest.fn(),
  } satisfies Pick<
    DeviceRepository,
    "findDevicesByAssignedUser" | "findDeviceById" | "recordButtonHeartbeat"
  >;
  const auth = {
    verifyToken: jest.fn(),
    isDeletionScheduled: jest.fn(),
  } satisfies Pick<AuthService, "verifyToken" | "isDeletionScheduled">;

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(now);
    repository.findDevicesByAssignedUser.mockImplementation(
      async (uid: string) =>
        uid === "owner-a" ? [button("BUT-111-AAA", new Date(now))] : [],
    );
    repository.findDeviceById.mockResolvedValue(button());
    repository.recordButtonHeartbeat.mockResolvedValue(undefined);
    auth.verifyToken.mockImplementation(async (token: string) => {
      if (!["owner-a", "owner-b"].includes(token))
        throw new UnauthorizedException();
      return { uid: token, email_verified: true };
    });
    auth.isDeletionScheduled.mockResolvedValue(false);
    module = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        DevicesService,
        { provide: DeviceRepository, useValue: repository },
        {
          provide: PhoneCameraService,
          useValue: { endSession: jest.fn() } satisfies Pick<
            PhoneCameraService,
            "endSession"
          >,
        },
        {
          provide: PinoLogger,
          useValue: { info: jest.fn() } satisfies Pick<PinoLogger, "info">,
        },
        {
          provide: DeviceTokenService,
          useValue: { issuePublisherToken: jest.fn() } satisfies Pick<
            DeviceTokenService,
            "issuePublisherToken"
          >,
        },
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = module.get(DevicesService);
    app = module.createNestApplication();
    app.setGlobalPrefix("v1");
    const reflector = module.get(Reflector);
    app.useGlobalGuards(
      new FirebaseAuthGuard(module.get(AuthService), reflector),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(reflector));
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it("requires a rider session and only queries that rider, ignoring a supplied owner", async () => {
    await request(app.getHttpServer()).get("/v1/devices/buttons").expect(401);
    await request(app.getHttpServer())
      .get("/v1/devices/buttons")
      .set("Authorization", "Bearer invalid")
      .expect(401);
    const own = await request(app.getHttpServer())
      .get("/v1/devices/buttons")
      .set("Authorization", "Bearer owner-a")
      .expect(200);
    expect(own.headers["cache-control"]).toBe("no-store");
    expect(own.body.data).toEqual([
      {
        device_id: "BUT-111-AAA",
        online: true,
        last_seen_at: new Date(now).toISOString(),
      },
    ]);
    expect(JSON.stringify(own.body)).not.toContain("deviceSecretHash");
    const other = await request(app.getHttpServer())
      .get("/v1/devices/buttons?uid=owner-a")
      .set("Authorization", "Bearer owner-b")
      .expect(200);
    expect(other.body.data).toEqual([]);
    expect(repository.findDevicesByAssignedUser).toHaveBeenLastCalledWith(
      "owner-b",
    );
    auth.isDeletionScheduled.mockResolvedValue(true);
    await request(app.getHttpServer())
      .get("/v1/devices/buttons")
      .set("Authorization", "Bearer owner-a")
      .expect(403);
  });

  it("expires an idle button without requiring a database cleanup job", async () => {
    repository.findDevicesByAssignedUser.mockResolvedValue([
      button("BUT-111-AAA", new Date(now - 90_000)),
      button("BUT-222-BBB", new Date(now - 90_001)),
      button("BUT-333-CCC"),
      button("BUT-444-DDD", new Date(now + 1)),
      Device.reconstitute({
        deviceId: "CAM-111-AAA",
        deviceType: DeviceType.CAMERA,
        status: DeviceStatus.PROVISIONED,
      }),
    ]);
    expect(
      (await service.findButtonsForUser("owner-a")).map((item) => item.online),
    ).toEqual([true, false, false, false]);
    await expect(service.findButtonsForUser(undefined)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("accepts the device secret without Firebase and never accepts a caller timestamp", async () => {
    const response = await request(app.getHttpServer())
      .post("/v1/devices/BUT-111-AAA/heartbeat")
      .set("Authorization", `Bearer ${secret}`)
      .send({ last_seen_at: "2099-01-01T00:00:00Z", uid: "other" })
      .expect(200);
    expect(response.body.data).toEqual({
      device_id: "BUT-111-AAA",
      heartbeat_interval_ms: 30000,
      online_timeout_ms: 90000,
    });
    expect(repository.recordButtonHeartbeat).toHaveBeenCalledWith(
      "BUT-111-AAA",
      hashDeviceSecret(secret),
    );
    expect(auth.verifyToken).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed, wrong and rider credentials before writing presence", async () => {
    for (const header of [
      "",
      "Basic fixture",
      "Bearer wrong",
      "Bearer owner-a",
      "Bearer two values",
    ]) {
      const call = request(app.getHttpServer()).post(
        "/v1/devices/BUT-111-AAA/heartbeat",
      );
      if (header) call.set("Authorization", header);
      await call.expect(401);
    }
    await request(app.getHttpServer())
      .post("/v1/devices/not-a-device/heartbeat")
      .set("Authorization", `Bearer ${secret}`)
      .expect(401);
    repository.findDeviceById.mockResolvedValue(null);
    await expect(
      service.reportButtonHeartbeat("BUT-999-ZZZ", `Bearer ${secret}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.recordButtonHeartbeat).not.toHaveBeenCalled();
  });

  it("rejects a camera credential and preserves an actual database error", async () => {
    repository.findDeviceById.mockResolvedValue(
      Device.reconstitute({
        deviceId: "CAM-111-AAA",
        deviceType: DeviceType.CAMERA,
        status: DeviceStatus.PROVISIONED,
        deviceSecretHash: hashDeviceSecret(secret),
      }),
    );
    await expect(
      service.reportButtonHeartbeat("CAM-111-AAA", `Bearer ${secret}`),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.findDeviceById.mockRejectedValue(
      new Error("fixture datastore unavailable"),
    );
    await expect(
      service.reportButtonHeartbeat("BUT-111-AAA", `Bearer ${secret}`),
    ).rejects.toThrow("fixture datastore unavailable");
    expect(repository.recordButtonHeartbeat).not.toHaveBeenCalled();
  });
});
