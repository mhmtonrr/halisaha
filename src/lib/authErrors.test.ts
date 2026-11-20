import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./authErrors";

describe("authErrorMessage", () => {
  it("bilinen hataları Türkçeye çevirir", () => {
    expect(authErrorMessage({ message: "Invalid login credentials", code: "invalid_credentials", status: 400 })).toMatch(/hatalı/);
    expect(authErrorMessage({ message: "User already registered", code: "user_already_exists" })).toMatch(/zaten bir hesap/);
    expect(authErrorMessage({ message: "x", status: 429 })).toMatch(/Çok fazla/);
    expect(authErrorMessage({ message: "Password should be at least 8 characters.", code: "weak_password" })).toMatch(/zayıf/);
  });
  it("bilinmeyen hatada genel mesaj verir, İngilizce metni göstermez", () => {
    expect(authErrorMessage({ message: "Something odd happened" })).toBe("Bir sorun oluştu, tekrar dene.");
  });
});
