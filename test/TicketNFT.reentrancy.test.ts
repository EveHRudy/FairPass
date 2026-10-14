import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { TicketNFT, ReentrancyAttacker, BurnHarness } from "../typechain-types";

describe("TicketNFT Reentrancy", function () {
  async function deployFixture() {
    const [deployer, organizer, seller, buyer, other] = await ethers.getSigners();

    const ticketNFT = (await ethers.deployContract("TicketNFT")) as unknown as TicketNFT;
    const attacker = (await ethers.deployContract("ReentrancyAttacker", [
      ticketNFT.target,
    ])) as unknown as ReentrancyAttacker;

    const now = await time.latest();
    const eventDate = BigInt(now) + 7n * 24n * 60n * 60n; // now + 7 days
    const faceValue = ethers.parseEther("0.05");
    const supply = 100n;
    const capPercent = 20;
    const royaltyPercent = 10;

    await ticketNFT.connect(organizer).createEvent(
      "Concert",
      eventDate,
      faceValue,
      supply,
      capPercent,
      royaltyPercent
    );

    return {
      ticketNFT,
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
    const { ticketNFT, attacker, organizer, buyer, faceValue } = await loadFixture(deployFixture);

    // Mint a ticket to the attacker contract using buyTicketOnTarget
    await attacker.buyTicketOnTarget(1, "ipfs://attacker", { value: faceValue });

    // Baseline organizer pending balance includes primary sale revenue
    const baselineOrgPending = await ticketNFT.pending(organizer.address);
    expect(baselineOrgPending).to.equal(faceValue);

    // Attacker sets mode 1 (re-enter withdraw) and lists ticket at 0.055 ETH
    await attacker.setMode(1);
    const price = ethers.parseEther("0.055");
    await attacker.listTicket(1, price);

    // Buyer buys it
    await ticketNFT.connect(buyer).buyResale(1, { value: price });

    // Assert initial pending balances and contract balance
    const expectedAttackerPending = ethers.parseEther("0.0495");
    const expectedRoyalty = ethers.parseEther("0.0055");
    expect(await ticketNFT.pending(attacker.target)).to.equal(expectedAttackerPending);

    // Assert on change since baseline
    const orgPendingAfterSale = await ticketNFT.pending(organizer.address);
    expect(orgPendingAfterSale - baselineOrgPending).to.equal(expectedRoyalty);

    // Contract balance holds primary revenue + resale price (sum of pending balances)
    const expectedContractBalance = expectedAttackerPending + orgPendingAfterSale;
    expect(await ethers.provider.getBalance(ticketNFT.target)).to.equal(expectedContractBalance);

    const attackerBalanceBefore = await ethers.provider.getBalance(attacker.target);

    // Run attackWithdraw
    await attacker.attackWithdraw();

    // Assertions
    expect(await attacker.reentryAttempted()).to.be.true;
    expect(await attacker.reentryBlocked()).to.be.true;

    const attackerBalanceAfter = await ethers.provider.getBalance(attacker.target);
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(expectedAttackerPending);

    // Organizer pending still intact
    expect(await ticketNFT.pending(organizer.address)).to.equal(orgPendingAfterSale);
    // Contract remaining balance equals organizer pending balance
    expect(await ethers.provider.getBalance(ticketNFT.target)).to.equal(orgPendingAfterSale);
  });

  it("buyResale re-entry from the withdraw callback (mode 2)", async function () {
    const { ticketNFT, attacker, seller, buyer, faceValue } = await loadFixture(deployFixture);

    // Mint ticket 1 to attacker, ticket 2 to seller
    await attacker.buyTicketOnTarget(1, "ipfs://attacker", { value: faceValue });
    await ticketNFT.connect(seller).buyTicket(1, "ipfs://seller", { value: faceValue });

    const price1 = ethers.parseEther("0.055");
    // Ticket 2 priced at attacker's expected pending balance (0.0495 ETH <= 0.0495 ETH)
    const price2 = ethers.parseEther("0.0495");

    await attacker.listTicket(1, price1);
    await ticketNFT.connect(seller).listForResale(2, price2);

    // Buyer buys ticket 1
    await ticketNFT.connect(buyer).buyResale(1, { value: price1 });

    // Attacker sets mode 2 targeting ticket 2
    await attacker.setMode(2);
    await attacker.setTargetTicket(2);

    const attackerBalanceBefore = await ethers.provider.getBalance(attacker.target);

    // Run attackWithdraw
    await attacker.attackWithdraw();

    // Assertions
    expect(await attacker.reentryAttempted()).to.be.true;
    expect(await attacker.reentryBlocked()).to.be.true;
    expect(await ticketNFT.ownerOf(2)).to.equal(seller.address);

    const attackerBalanceAfter = await ethers.provider.getBalance(attacker.target);
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(ethers.parseEther("0.0495"));
  });

  it("attacker cannot withdraw twice", async function () {
    const { ticketNFT, attacker, buyer, faceValue } = await loadFixture(deployFixture);

    await attacker.buyTicketOnTarget(1, "ipfs://attacker", { value: faceValue });
    const price = ethers.parseEther("0.055");
    await attacker.listTicket(1, price);
    await ticketNFT.connect(buyer).buyResale(1, { value: price });

    await attacker.attackWithdraw();

    // Second attackWithdraw reverts with "Nothing to withdraw"
    await expect(attacker.attackWithdraw()).to.be.revertedWith("Nothing to withdraw");
  });

  it("buyResale makes no ETH callback to the seller", async function () {
    const { ticketNFT, seller, buyer, faceValue } = await loadFixture(deployFixture);

    await ticketNFT.connect(seller).buyTicket(1, "ipfs://seller", { value: faceValue });
    const price = ethers.parseEther("0.055");
    await ticketNFT.connect(seller).listForResale(1, price);

    const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

    await ticketNFT.connect(buyer).buyResale(1, { value: price });

    const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
    // Seller balance must be completely unchanged by the purchase
    expect(sellerBalanceAfter).to.equal(sellerBalanceBefore);

    // Only after withdraw does seller receive ETH
    await expect(ticketNFT.connect(seller).withdraw()).to.changeEtherBalance(
      seller,
      ethers.parseEther("0.0495")
    );
  });

  it("withdraw re-entry cannot drain funds when contract holds multiple balances", async function () {
    const { ticketNFT, attacker, seller, buyer, organizer, faceValue } = await loadFixture(deployFixture);

    // Attacker owns ticket 1, seller owns ticket 2
    await attacker.buyTicketOnTarget(1, "ipfs://attacker", { value: faceValue });
    await ticketNFT.connect(seller).buyTicket(1, "ipfs://seller", { value: faceValue });

    const price = ethers.parseEther("0.055");
    await attacker.listTicket(1, price);
    await ticketNFT.connect(seller).listForResale(2, price);

    // Buyer buys both tickets
    await ticketNFT.connect(buyer).buyResale(1, { value: price });
    await ticketNFT.connect(buyer).buyResale(2, { value: price });

    const attackerPending = await ticketNFT.pending(attacker.target);
    const sellerPending = await ticketNFT.pending(seller.address);
    const organizerPending = await ticketNFT.pending(organizer.address);

    expect(await ethers.provider.getBalance(ticketNFT.target)).to.equal(
      attackerPending + sellerPending + organizerPending
    );

    await attacker.setMode(1);
    const attackerBalanceBefore = await ethers.provider.getBalance(attacker.target);

    await attacker.attackWithdraw();

    expect(await attacker.reentryAttempted()).to.be.true;
    expect(await attacker.reentryBlocked()).to.be.true;

    const attackerBalanceAfter = await ethers.provider.getBalance(attacker.target);
    expect(attackerBalanceAfter - attackerBalanceBefore).to.equal(attackerPending);

    // Seller's pending balance is completely safe
    expect(await ticketNFT.pending(seller.address)).to.equal(sellerPending);
    // Contract still holds seller's share + organizer pending (primary + royalties)
    expect(await ethers.provider.getBalance(ticketNFT.target)).to.equal(
      sellerPending + organizerPending
    );
  });

  it("burning reverts 'Burn disabled'", async function () {
    const burnHarness = (await ethers.deployContract("BurnHarness")) as unknown as BurnHarness;
    const [deployer, organizer, user] = await ethers.getSigners();
    const now = await time.latest();

    await burnHarness.connect(organizer).createEvent(
      "BurnEvent",
      BigInt(now) + 10000n,
      ethers.parseEther("0.05"),
      100n,
      20,
      10
    );
    await burnHarness.connect(user).buyTicket(1, "ipfs://burn", { value: ethers.parseEther("0.05") });

    await expect(burnHarness.burnForTest(1)).to.be.revertedWith("Burn disabled");
  });

  it("a plain burn through a normal transfer path is blocked with 'Use marketplace'", async function () {
    const { ticketNFT, buyer, faceValue } = await loadFixture(deployFixture);
    await ticketNFT.connect(buyer).buyTicket(1, "ipfs://plainburn", { value: faceValue });
    const burnAddress = "0x000000000000000000000000000000000000dEaD";
    await expect(
      ticketNFT.connect(buyer).transferFrom(buyer.address, burnAddress, 1)
    ).to.be.revertedWith("Use marketplace");
  });
});
