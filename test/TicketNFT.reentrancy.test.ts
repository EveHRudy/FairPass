import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { TicketNFTHarness, ReentrancyAttacker, BurnHarness } from "../typechain-types";

describe("TicketNFT Reentrancy", function () {
  async function deployFixture() {
    const [deployer, organizer, seller, buyer, other] = await ethers.getSigners();

    const harness = (await ethers.deployContract("TicketNFTHarness")) as unknown as TicketNFTHarness;
    const attacker = (await ethers.deployContract("ReentrancyAttacker", [
      harness.target,
    ])) as unknown as ReentrancyAttacker;

    const now = await time.latest();
    const eventDate = BigInt(now) + 7n * 24n * 60n * 60n; // now + 7 days
    const faceValue = ethers.parseEther("0.05");
    const supply = 100n;
    const capPercent = 20;
    const royaltyPercent = 10;

    await harness.createEventForTest(
      organizer.address,
      eventDate,
      faceValue,
      supply,
      capPercent,
      royaltyPercent
    );

    return {
      harness,
      attacker,
      deployer,
      organizer,
      seller,
      buyer,
      other,
      eventDate,
      faceValue,
      capPercent,
      royaltyPercent,
    };
  }

  it("withdraw re-entry (mode 1)", async function () {
    const { harness, attacker, organizer, buyer } = await loadFixture(deployFixture);

    // Mint a ticket to the attacker contract
    await harness.mintForTest(attacker.target, 1);

    // Attacker sets mode 1 (re-enter withdraw) and lists ticket at 0.055 ETH
    await attacker.setMode(1);
    const price = ethers.parseEther("0.055");
    await attacker.listTicket(1, price);

    // Buyer buys it
    await harness.connect(buyer).buyResale(1, { value: price });

    // Assert initial pending balances and contract balance
    const expectedAttackerPending = ethers.parseEther("0.0495");
    const expectedOrganizerPending = ethers.parseEther("0.0055");
    expect(await harness.pending(attacker.target)).to.equal(expectedAttackerPending);
    expect(await harness.pending(organizer.address)).to.equal(expectedOrganizerPending);
    expect(await ethers.provider.getBalance(harness.target)).to.equal(price);

    const attackerBalanceBefore = await ethers.provider.getBalance(attacker.target);

    // Run attackWithdraw
    await attacker.attackWithdraw();

    // Assertions
    expect(await attacker.reentryAttempted()).to.be.true;
    expect(await attacker.reentryBlocked()).to.be.true;

    const attackerBalanceAfter = await ethers.provider.getBalance(attacker.target);
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(expectedAttackerPending);

    expect(await harness.pending(organizer.address)).to.equal(expectedOrganizerPending);
    expect(await ethers.provider.getBalance(harness.target)).to.equal(expectedOrganizerPending);
  });

  it("buyResale re-entry from the withdraw callback (mode 2)", async function () {
    const { harness, attacker, seller, buyer } = await loadFixture(deployFixture);

    // Mint ticket 1 to attacker, ticket 2 to seller
    await harness.mintForTest(attacker.target, 1);
    await harness.mintForTest(seller.address, 1);

    const price1 = ethers.parseEther("0.055");
    // Ticket 2 priced at attacker's expected pending balance (0.0495 ETH <= 0.0495 ETH)
    const price2 = ethers.parseEther("0.0495");

    await attacker.listTicket(1, price1);
    await harness.connect(seller).listForResale(2, price2);

    // Buyer buys ticket 1
    await harness.connect(buyer).buyResale(1, { value: price1 });

    // Attacker sets mode 2 targeting ticket 2
    await attacker.setMode(2);
    await attacker.setTargetTicket(2);

    const attackerBalanceBefore = await ethers.provider.getBalance(attacker.target);

    // Run attackWithdraw
    await attacker.attackWithdraw();

    // Assertions
    expect(await attacker.reentryAttempted()).to.be.true;
    expect(await attacker.reentryBlocked()).to.be.true;
    expect(await harness.ownerOf(2)).to.equal(seller.address);

    const attackerBalanceAfter = await ethers.provider.getBalance(attacker.target);
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(ethers.parseEther("0.0495"));
  });

  it("attacker cannot withdraw twice", async function () {
    const { harness, attacker, buyer } = await loadFixture(deployFixture);

    await harness.mintForTest(attacker.target, 1);
    const price = ethers.parseEther("0.055");
    await attacker.listTicket(1, price);
    await harness.connect(buyer).buyResale(1, { value: price });

    await attacker.attackWithdraw();

    // Second attackWithdraw reverts with "Nothing to withdraw"
    await expect(attacker.attackWithdraw()).to.be.revertedWith("Nothing to withdraw");
  });

  it("buyResale makes no ETH callback to the seller", async function () {
    const { harness, seller, buyer } = await loadFixture(deployFixture);

    await harness.mintForTest(seller.address, 1);
    const price = ethers.parseEther("0.055");
    await harness.connect(seller).listForResale(1, price);

    const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

    await harness.connect(buyer).buyResale(1, { value: price });

    const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
    // Seller balance must be completely unchanged by the purchase
    expect(sellerBalanceAfter).to.equal(sellerBalanceBefore);

    // Only after withdraw does seller receive ETH
    await expect(harness.connect(seller).withdraw()).to.changeEtherBalance(
      seller,
      ethers.parseEther("0.0495")
    );
  });

  it("withdraw re-entry cannot drain funds when contract holds multiple balances", async function () {
    const { harness, attacker, seller, buyer } = await loadFixture(deployFixture);

    // Attacker owns ticket 1, seller owns ticket 2
    await harness.mintForTest(attacker.target, 1);
    await harness.mintForTest(seller.address, 1);

    const price = ethers.parseEther("0.055");
    await attacker.listTicket(1, price);
    await harness.connect(seller).listForResale(2, price);

    // Buyer buys both tickets -> contract holds 0.11 ETH total
    await harness.connect(buyer).buyResale(1, { value: price });
    await harness.connect(buyer).buyResale(2, { value: price });

    expect(await ethers.provider.getBalance(harness.target)).to.equal(ethers.parseEther("0.11"));

    await attacker.setMode(1);
    const attackerBalanceBefore = await ethers.provider.getBalance(attacker.target);

    await attacker.attackWithdraw();

    expect(await attacker.reentryAttempted()).to.be.true;
    expect(await attacker.reentryBlocked()).to.be.true;

    const attackerBalanceAfter = await ethers.provider.getBalance(attacker.target);
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(ethers.parseEther("0.0495"));

    // Seller's pending balance is completely safe
    expect(await harness.pending(seller.address)).to.equal(ethers.parseEther("0.0495"));
    // Contract still holds seller's share + royalties (0.11 - 0.0495 = 0.0605 ETH)
    expect(await ethers.provider.getBalance(harness.target)).to.equal(ethers.parseEther("0.0605"));
  });

  it("burning reverts 'Burn disabled'", async function () {
    const burnHarness = (await ethers.deployContract("BurnHarness")) as unknown as BurnHarness;
    const [deployer, organizer, user] = await ethers.getSigners();
    const now = await time.latest();

    await burnHarness.createEventForTest(
      organizer.address,
      BigInt(now) + 10000n,
      ethers.parseEther("0.05"),
      100n,
      20,
      10
    );
    await burnHarness.mintForTest(user.address, 1);

    await expect(burnHarness.burnForTest(1)).to.be.revertedWith("Burn disabled");
  });
});
