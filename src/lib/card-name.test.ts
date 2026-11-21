import { describe, expect, it } from "vitest";
import { fitCardName } from "./card-name";

describe("fitCardName", () => {
  it("sığan adı olduğu gibi bırakır", () => expect(fitCardName("Berk Beycan")).toBe("Berk Beycan"));
  it("uzun soyadı baş harfe indirir", () => expect(fitCardName("Mehmet Onur Duman")).toBe("Mehmet Onur D."));
  it("yine uzunsa ilk ad + soyad baş harfi", () => expect(fitCardName("Abdurrahman Kemalettin Yıldırım")).toBe("Abdurrahman Y."));
  it("tek uzun kelimeyi keser", () => expect(fitCardName("Abdurrahmanhüseyinoğlu")).toBe("Abdurrahmanhüs…"));
  it("çok kelimede ilk ad + soyad baş harfi (Ö)", () => expect(fitCardName("Ahmet Mehmet İlhan Özdemir")).toBe("Ahmet Ö."));
  it("fazla boşlukları sadeleştirir", () => expect(fitCardName("  Ali   Can ")).toBe("Ali Can"));
});
