import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("TicketNFT Person 1", function () {
  async function fixture() {
    const [deployer, organizer, buyer, venue, other] = await ethers.getSigners();
    const c = await ethers.deployContract("TicketNFT");
    const now = await time.latest();
    const date = BigInt(now) + 7n * 86400n;
    const face = ethers.parseEther("0.05");
    await c.connect(organizer).createEvent("Show", date, face, 2n, 20, 10);
    return { c, organizer, buyer, venue, other, date, face };
  }

  it("createEvent stores the event and emits EventCreated", async () => {
    const { c, organizer, date, face } = await loadFixture(fixture);
    const e = await c.events(1);
    expect(e.organizer).to.equal(organizer.address);
    expect(e.faceValue).to.equal(face);
    expect(e.date).to.equal(date);
    expect(await c.nextEventId()).to.equal(2n);
  });

  it("createEvent validation reverts", async () => {
    const { c, date, face } = await loadFixture(fixture);
    const now = BigInt(await time.latest());
    await expect(c.createEvent("x", now, face, 1, 20, 10)).to.be.revertedWith("Bad date");
    await expect(c.createEvent("x", date, 0, 1, 20, 10)).to.be.revertedWith("Bad face value");
    await expect(c.createEvent("x", date, face, 0, 20, 10)).to.be.revertedWith("Bad supply");
    await expect(c.createEvent("x", date, face, 1, 101, 10)).to.be.revertedWith("Bad cap");
    await expect(c.createEvent("x", date, face, 1, 20, 51)).to.be.revertedWith("Bad royalty");
  });

  it("buyTicket mints, sets URI, credits organizer", async () => {
    const { c, organizer, buyer, face } = await loadFixture(fixture);
    await expect(c.connect(buyer).buyTicket(1, "ipfs://cid1", { value: face }))
      .to.emit(c, "TicketMinted").withArgs(1, 1, buyer.address, face);
    expect(await c.ownerOf(1)).to.equal(buyer.address);
    expect(await c.tokenURI(1)).to.equal("ipfs://cid1");
    expect(await c.pending(organizer.address)).to.equal(face);
    expect((await c.events(1)).sold).to.equal(1n);
  });

  it("buyTicket reverts: bad payment, sold out, wallet limit, no event, past event", async () => {
    const { c, buyer, other, face, date } = await loadFixture(fixture);
    await expect(c.connect(buyer).buyTicket(1, "u", { value: face - 1n })).to.be.revertedWith("Bad payment");
    await expect(c.connect(buyer).buyTicket(99, "u", { value: face })).to.be.revertedWith("No such event");
    await c.connect(buyer).buyTicket(1, "u", { value: face });
    await c.connect(buyer).buyTicket(1, "u", { value: face });
    await expect(c.connect(other).buyTicket(1, "u", { value: face })).to.be.revertedWith("Sold out");
    // wallet limit: new event with big supply
    await c.createEvent("Big", date, face, 100n, 20, 10);
    for (let i = 0; i < 4; i++) await c.connect(buyer).buyTicket(2, "u", { value: face });
    await expect(c.connect(buyer).buyTicket(2, "u", { value: face })).to.be.revertedWith("Wallet limit reached");
    await time.increaseTo(date + 1n);
    await expect(c.connect(other).buyTicket(2, "u", { value: face })).to.be.revertedWith("Event passed");
  });

  it("checkIn: organizer or venue only, once only", async () => {
    const { c, organizer, buyer, venue, other, face } = await loadFixture(fixture);
    await c.connect(buyer).buyTicket(1, "u", { value: face });
    await expect(c.connect(other).checkIn(1)).to.be.revertedWith("Not authorized");
    await expect(c.connect(organizer).checkIn(99)).to.be.revertedWith("No such ticket");
    await c.connect(organizer).addVenue(1, venue.address);
    await expect(c.connect(venue).checkIn(1)).to.emit(c, "CheckedIn").withArgs(1, venue.address);
    expect(await c.used(1)).to.equal(true);
    await expect(c.connect(venue).checkIn(1)).to.be.revertedWith("Already used");
  });

  it("venues: organizer only, removal works", async () => {
    const { c, organizer, buyer, venue, other, face } = await loadFixture(fixture);
    await expect(c.connect(other).addVenue(1, venue.address)).to.be.revertedWith("Not authorized");
    await c.connect(organizer).addVenue(1, venue.address);
    expect(await c.isVenue(1, venue.address)).to.equal(true);
    await c.connect(organizer).removeVenue(1, venue.address);
    await c.connect(buyer).buyTicket(1, "u", { value: face });
    await expect(c.connect(venue).checkIn(1)).to.be.revertedWith("Not authorized");
  });

  it("full flow: buy, list, resale, withdraw", async () => {
    const { c, organizer, buyer, other, face } = await loadFixture(fixture);
    await c.connect(buyer).buyTicket(1, "u", { value: face });
    const price = ethers.parseEther("0.06");
    await c.connect(buyer).listForResale(1, price);
    await c.connect(other).buyResale(1, { value: price });
    expect(await c.ownerOf(1)).to.equal(other.address);
    await expect(c.connect(other).withdraw()).to.be.revertedWith("Nothing to withdraw");
    await expect(c.connect(organizer).withdraw()).to.emit(c, "Withdrawn").withArgs(organizer.address, face + ethers.parseEther("0.006"));
  });
});
