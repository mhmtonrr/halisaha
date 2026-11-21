import { describe, expect, it } from "vitest";
import { extractInviteCode, formatInviteCode, kindMatches, parseKind } from "./invite";

describe("extractInviteCode", () => {
  it("düz kodu büyük harfe çevirir", () => expect(extractInviteCode("abcde12345")).toBe("ABCDE12345"));
  it("tire ve boşlukları atar", () => {
    expect(extractInviteCode(" abcde-12345 ")).toBe("ABCDE12345");
    expect(extractInviteCode("ABCDE 12345")).toBe("ABCDE12345");
  });
  it("tam linkten kodu alır, sorgu ve parçayı yok sayar", () => {
    expect(extractInviteCode("https://halisaha-tawny.vercel.app/join/ABCDE12345")).toBe("ABCDE12345");
    expect(extractInviteCode("https://x.app/join/abcde12345/?utm=1#a")).toBe("ABCDE12345");
  });
  it("eski 12 karakterli kodu korur", () => expect(extractInviteCode("a1b2c3d4e5f6")).toBe("A1B2C3D4E5F6"));
  it("boş girdi boş döner", () => {
    expect(extractInviteCode("")).toBe("");
    expect(extractInviteCode("   ")).toBe("");
  });
});

describe("formatInviteCode", () => {
  it("10 karakteri ikiye böler", () => expect(formatInviteCode("abcde12345")).toBe("ABCDE-12345"));
  it("eski kodu bozmaz", () => expect(formatInviteCode("a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6"));
});

describe("tür", () => {
  it("parseKind sadece takim/grup kabul eder", () => {
    expect(parseKind("takim")).toBe("takim");
    expect(parseKind("grup")).toBe("grup");
    expect(parseKind("x")).toBeNull();
    expect(parseKind(undefined)).toBeNull();
  });
  it("kindMatches", () => {
    expect(kindMatches("takim", "team")).toBe(true);
    expect(kindMatches("takim", "community")).toBe(false);
    expect(kindMatches("grup", "community")).toBe(true);
    expect(kindMatches("grup", "team")).toBe(false);
    expect(kindMatches(null, "team")).toBe(true);
  });
});
