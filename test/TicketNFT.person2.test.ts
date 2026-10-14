import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { TicketNFT } from "../typechain-types";

describe("TicketNFT Person 2", function () {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [deployer, organizer, seller, buyer, other] = signers;

    const ticketNFT = (await ethers.deployContract("TicketNFT")) as unknown as TicketNFT;

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

    // Mint ticket 1 to seller via real buyTicket
    await ticketNFT.connect(seller).buyTicket(1, "ipfs://test", { value: faceValue });

    return {
      ticketNFT,
      deployer,
      organizer,
      seller,
      buyer,
      other,
      signers,
      eventDate,
      faceValue,
      capPercent,
      royaltyPercent,
    };
  }

  describe("maxResalePrice and listing", function () {
    it("maxResalePrice equals 0.06 ETH", async function () {
      const { ticketNFT } = await loadFixture(deployFixture);
      expect(await ticketNFT.maxResalePrice(1)).to.equal(ethers.parseEther("0.06"));
    });

    it("list exactly at cap", async function () {
      const { ticketNFT, seller } = await loadFixture(deployFixture);
      const cap = ethers.parseEther("0.06");
      await expect(ticketNFT.connect(seller).listForResale(1, cap))
        .to.emit(ticketNFT, "Listed")
        .withArgs(1, seller.address, cap);
      expect(await ticketNFT.listings(1)).to.equal(cap);
    });

    it("cap + 1 wei reverts 'Above cap'", async function () {
      const { ticketNFT, seller } = await loadFixture(deployFixture);
      const cap = ethers.parseEther("0.06");
      await expect(
        ticketNFT.connect(seller).listForResale(1, cap + 1n)
      ).to.be.revertedWith("Above cap");
    });

    it("price 0 reverts 'Bad price'", async function () {
      const { ticketNFT, seller } = await loadFixture(deployFixture);
      await expect(
        ticketNFT.connect(seller).listForResale(1, 0)
      ).to.be.revertedWith("Bad price");
    });

    it("non-owner reverts 'Not owner'", async function () {
      const { ticketNFT, other } = await loadFixture(deployFixture);
      const cap = ethers.parseEther("0.06");
      await expect(
        ticketNFT.connect(other).listForResale(1, cap)
      ).to.be.revertedWith("Not owner");
    });

    it("12 hours before the event reverts 'Resale locked'", async function () {
      const { ticketNFT, seller, eventDate } = await loadFixture(deployFixture);
      await time.increaseTo(eventDate - 12n * 3600n);
      await expect(
        ticketNFT.connect(seller).listForResale(1, ethers.parseEther("0.05"))
      ).to.be.revertedWith("Resale locked");
    });

    it("used ticket reverts 'Ticket used'", async function () {
      const { ticketNFT, organizer, seller } = await loadFixture(deployFixture);
      await ticketNFT.connect(organizer).checkIn(1);
      await expect(
        ticketNFT.connect(seller).listForResale(1, ethers.parseEther("0.05"))
      ).to.be.revertedWith("Ticket used");
    });

    it("third resale reverts 'Max resales reached'", async function () {
      const { ticketNFT, seller, buyer, other } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");

      // Resale 1: seller -> buyer
      await ticketNFT.connect(seller).listForResale(1, price);
      expect(await ticketNFT.ownerOf(1)).to.equal(seller.address);
      await ticketNFT.connect(buyer).buyResale(1, { value: price });
      expect(await ticketNFT.ownerOf(1)).to.equal(buyer.address);

      // Resale 2: buyer -> other
      await ticketNFT.connect(buyer).listForResale(1, price);
      expect(await ticketNFT.ownerOf(1)).to.equal(buyer.address);
      await ticketNFT.connect(other).buyResale(1, { value: price });
      expect(await ticketNFT.ownerOf(1)).to.equal(other.address);

      // Resale 3: other attempts to list -> blocked
      await expect(
        ticketNFT.connect(other).listForResale(1, price)
      ).to.be.revertedWith("Max resales reached");
    });
  });

  describe("cancelListing", function () {
    it("cancel by owner", async function () {
      const { ticketNFT, seller } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");
      await ticketNFT.connect(seller).listForResale(1, price);
      await expect(ticketNFT.connect(seller).cancelListing(1))
        .to.emit(ticketNFT, "ListingCancelled")
        .withArgs(1);
      expect(await ticketNFT.listings(1)).to.equal(0n);
    });

    it("cancel when unlisted", async function () {
      const { ticketNFT, seller } = await loadFixture(deployFixture);
      await expect(
        ticketNFT.connect(seller).cancelListing(1)
      ).to.be.revertedWith("Not listed");
    });

    it("cancel by non-owner", async function () {
      const { ticketNFT, seller, other } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");
      await ticketNFT.connect(seller).listForResale(1, price);
      await expect(
        ticketNFT.connect(other).cancelListing(1)
      ).to.be.revertedWith("Not owner");
    });

    it("buying a cancelled listing reverts 'Not listed'", async function () {
      const { ticketNFT, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");
      await ticketNFT.connect(seller).listForResale(1, price);
      await ticketNFT.connect(seller).cancelListing(1);
      await expect(
        ticketNFT.connect(buyer).buyResale(1, { value: price })
      ).to.be.revertedWith("Not listed");
    });
  });

  describe("buyResale", function () {
    it("wrong payment reverts 'Bad payment'", async function () {
      const { ticketNFT, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await ticketNFT.connect(seller).listForResale(1, price);
      await expect(
        ticketNFT.connect(buyer).buyResale(1, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Bad payment");
    });

    it("buying your own ticket reverts 'Own ticket'", async function () {
      const { ticketNFT, seller } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await ticketNFT.connect(seller).listForResale(1, price);
      await expect(
        ticketNFT.connect(seller).buyResale(1, { value: price })
      ).to.be.revertedWith("Own ticket");
    });

    it("buying a used listed ticket reverts 'Ticket used'", async function () {
      const { ticketNFT, organizer, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await ticketNFT.connect(seller).listForResale(1, price);
      await ticketNFT.connect(organizer).checkIn(1);
      await expect(
        ticketNFT.connect(buyer).buyResale(1, { value: price })
      ).to.be.revertedWith("Ticket used");
    });

    it("successful sale", async function () {
      const { ticketNFT, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      const royalty = ethers.parseEther("0.0055");

      await ticketNFT.connect(seller).listForResale(1, price);
      expect(await ticketNFT.ownerOf(1)).to.equal(seller.address);

      await expect(ticketNFT.connect(buyer).buyResale(1, { value: price }))
        .to.emit(ticketNFT, "Sold")
        .withArgs(1, seller.address, buyer.address, price, royalty);

      expect(await ticketNFT.ownerOf(1)).to.equal(buyer.address);
      expect(await ticketNFT.listings(1)).to.equal(0n);
      expect(await ticketNFT.resaleCount(1)).to.equal(1);
    });
  });

  describe("royalty and rounding", function () {
    it("pending balances after a 0.055 ETH sale", async function () {
      const { ticketNFT, organizer, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");

      // Organizer pending balance before resale includes 0.05 ETH from primary sale
      const orgPendingBefore = await ticketNFT.pending(organizer.address);

      await ticketNFT.connect(seller).listForResale(1, price);
      expect(await ticketNFT.ownerOf(1)).to.equal(seller.address);

      await ticketNFT.connect(buyer).buyResale(1, { value: price });
      expect(await ticketNFT.ownerOf(1)).to.equal(buyer.address);

      // Assert organizer pending increased by exactly 0.0055 ETH royalty
      const orgPendingAfter = await ticketNFT.pending(organizer.address);
      expect(orgPendingAfter - orgPendingBefore).to.equal(ethers.parseEther("0.0055"));
      expect(await ticketNFT.pending(seller.address)).to.equal(ethers.parseEther("0.0495"));
    });

    it("the rounding loop for [1n, 7n, 33n, 12345678901234567n, 0.06 ETH]", async function () {
      const { ticketNFT, organizer, seller, signers, eventDate, faceValue, capPercent, royaltyPercent } =
        await loadFixture(deployFixture);
      const testPrices = [
        1n,
        7n,
        33n,
        12345678901234567n,
        ethers.parseEther("0.06"),
      ];

      for (let i = 0; i < testPrices.length; i++) {
        const price = testPrices[i];
        const eventId = BigInt(i + 2);

        // Create separate event to respect the 4 tickets per wallet limit
        await ticketNFT.connect(organizer).createEvent(
          `RoundEvent_${i}`,
          eventDate,
          faceValue,
          100n,
          capPercent,
          royaltyPercent
        );

        const ticketId = await ticketNFT.connect(seller).buyTicket.staticCall(
          eventId,
          `ipfs://round_${i}`,
          { value: faceValue }
        );
        await ticketNFT.connect(seller).buyTicket(
          eventId,
          `ipfs://round_${i}`,
          { value: faceValue }
        );
        expect(await ticketNFT.ownerOf(ticketId)).to.equal(seller.address);

        // Use a distinct buyer per ticket
        const resaleBuyer = signers[5 + i];
        const prevOrg = await ticketNFT.pending(organizer.address);
        const prevSeller = await ticketNFT.pending(seller.address);

        await ticketNFT.connect(seller).listForResale(ticketId, price);
        expect(await ticketNFT.listings(ticketId)).to.equal(price);

        await ticketNFT.connect(resaleBuyer).buyResale(ticketId, { value: price });
        expect(await ticketNFT.ownerOf(ticketId)).to.equal(resaleBuyer.address);

        const newOrg = await ticketNFT.pending(organizer.address);
        const newSeller = await ticketNFT.pending(seller.address);

        const delta = (newOrg - prevOrg) + (newSeller - prevSeller);
        expect(delta).to.equal(price);
      }
    });
  });

  describe("transfer lock", function () {
    it("transferFrom by owner", async function () {
      const { ticketNFT, seller, buyer } = await loadFixture(deployFixture);
      await expect(
        ticketNFT.connect(seller).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("safeTransferFrom by owner", async function () {
      const { ticketNFT, seller, buyer } = await loadFixture(deployFixture);
      await expect(
        ticketNFT
          .connect(seller)
          ["safeTransferFrom(address,address,uint256)"](
            seller.address,
            buyer.address,
            1
          )
      ).to.be.revertedWith("Use marketplace");
    });

    it("operator after approve", async function () {
      const { ticketNFT, seller, buyer, other } = await loadFixture(deployFixture);
      await ticketNFT.connect(seller).approve(other.address, 1);
      await expect(
        ticketNFT.connect(other).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("operator after setApprovalForAll", async function () {
      const { ticketNFT, seller, buyer, other } = await loadFixture(deployFixture);
      await ticketNFT.connect(seller).setApprovalForAll(other.address, true);
      await expect(
        ticketNFT.connect(other).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("minting still works", async function () {
      const { ticketNFT, buyer, faceValue } = await loadFixture(deployFixture);
      await ticketNFT.connect(buyer).buyTicket(1, "ipfs://mint2", { value: faceValue });
      expect(await ticketNFT.ownerOf(2)).to.equal(buyer.address);
    });
  });

  describe("withdraw", function () {
    async function saleFixture() {
      const base = await deployFixture();
      const price = ethers.parseEther("0.055");
      await base.ticketNFT.connect(base.seller).listForResale(1, price);
      await base.ticketNFT.connect(base.buyer).buyResale(1, { value: price });
      return { ...base, price };
    }

    it("withdraw pays the seller exactly", async function () {
      const { ticketNFT, seller } = await loadFixture(saleFixture);
      const expectedSellerAmount = ethers.parseEther("0.0495");

      await expect(ticketNFT.connect(seller).withdraw()).to.changeEtherBalance(
        seller,
        expectedSellerAmount
      );
      expect(await ticketNFT.pending(seller.address)).to.equal(0n);
    });

    it("withdraw pays the organizer exactly", async function () {
      const { ticketNFT, organizer, faceValue } = await loadFixture(saleFixture);
      // Primary sale (0.05 ETH) + royalty (0.0055 ETH) = 0.0555 ETH
      const primaryRevenue = faceValue;
      const royalty = ethers.parseEther("0.0055");
      const expectedOrganizerTotal = primaryRevenue + royalty;

      const pendingBeforeWithdraw = await ticketNFT.pending(organizer.address);
      expect(pendingBeforeWithdraw).to.equal(expectedOrganizerTotal);

      await expect(ticketNFT.connect(organizer).withdraw()).to.changeEtherBalance(
        organizer,
        expectedOrganizerTotal
      );
      expect(await ticketNFT.pending(organizer.address)).to.equal(0n);
    });

    it("the Withdrawn event is emitted", async function () {
      const { ticketNFT, seller } = await loadFixture(saleFixture);
      const expectedSellerAmount = ethers.parseEther("0.0495");

      await expect(ticketNFT.connect(seller).withdraw())
        .to.emit(ticketNFT, "Withdrawn")
        .withArgs(seller.address, expectedSellerAmount);
    });

    it("withdraw with zero balance reverts 'Nothing to withdraw'", async function () {
      const { ticketNFT, other } = await loadFixture(saleFixture);
      await expect(ticketNFT.connect(other).withdraw()).to.be.revertedWith(
        "Nothing to withdraw"
      );
    });

    it("a second withdraw reverts", async function () {
      const { ticketNFT, seller } = await loadFixture(saleFixture);
      await ticketNFT.connect(seller).withdraw();
      await expect(ticketNFT.connect(seller).withdraw()).to.be.revertedWith(
        "Nothing to withdraw"
      );
    });
  });

  describe("integration with real functions", function () {
    it("a ticket checked in through checkIn cannot be listed ('Ticket used')", async function () {
      const { ticketNFT, organizer, seller } = await loadFixture(deployFixture);
      await ticketNFT.connect(organizer).checkIn(1);
      await expect(
        ticketNFT.connect(seller).listForResale(1, ethers.parseEther("0.05"))
      ).to.be.revertedWith("Ticket used");
    });

    it("a ticket listed before check-in cannot be bought after check-in ('Ticket used')", async function () {
      const { ticketNFT, organizer, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await ticketNFT.connect(seller).listForResale(1, price);
      await ticketNFT.connect(organizer).checkIn(1);
      await expect(
        ticketNFT.connect(buyer).buyResale(1, { value: price })
      ).to.be.revertedWith("Ticket used");
    });

    it("full flow: createEvent, buyTicket, listForResale at the cap, buyResale, withdraw by seller and organizer", async function () {
      const [deployer, organizer, seller, buyer] = await ethers.getSigners();
      const ticketNFT = (await ethers.deployContract("TicketNFT")) as unknown as TicketNFT;

      const now = await time.latest();
      const eventDate = BigInt(now) + 7n * 24n * 60n * 60n;
      const faceValue = ethers.parseEther("0.05");
      const supply = 50n;
      const capPercent = 20;
      const royaltyPercent = 10;

      await ticketNFT.connect(organizer).createEvent(
        "FullFlowEvent",
        eventDate,
        faceValue,
        supply,
        capPercent,
        royaltyPercent
      );

      // 1. buyTicket
      const ticketId = await ticketNFT.connect(seller).buyTicket.staticCall(
        1,
        "ipfs://fullflow",
        { value: faceValue }
      );
      await ticketNFT.connect(seller).buyTicket(
        1,
        "ipfs://fullflow",
        { value: faceValue }
      );
      expect(await ticketNFT.ownerOf(ticketId)).to.equal(seller.address);

      // 2. listForResale at the cap
      const cap = await ticketNFT.maxResalePrice(ticketId);
      expect(cap).to.equal(ethers.parseEther("0.06"));
      await ticketNFT.connect(seller).listForResale(ticketId, cap);

      // 3. buyResale
      await ticketNFT.connect(buyer).buyResale(ticketId, { value: cap });
      expect(await ticketNFT.ownerOf(ticketId)).to.equal(buyer.address);

      // 4. withdraw by seller and organizer
      const expectedRoyalty = (cap * 10n) / 100n; // 0.006 ETH
      const expectedSellerPayout = cap - expectedRoyalty; // 0.054 ETH
      const expectedOrganizerPayout = faceValue + expectedRoyalty; // 0.05 + 0.006 = 0.056 ETH

      await expect(ticketNFT.connect(seller).withdraw()).to.changeEtherBalance(
        seller,
        expectedSellerPayout
      );
      expect(await ticketNFT.pending(seller.address)).to.equal(0n);

      await expect(ticketNFT.connect(organizer).withdraw()).to.changeEtherBalance(
        organizer,
        expectedOrganizerPayout
      );
      expect(await ticketNFT.pending(organizer.address)).to.equal(0n);
    });

    it("transferFrom is blocked on a ticket minted by the real buyTicket ('Use marketplace')", async function () {
      const { ticketNFT, seller, buyer } = await loadFixture(deployFixture);
      await expect(
        ticketNFT.connect(seller).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("listing 12 hours before the event reverts 'Resale locked'", async function () {
      const { ticketNFT, seller, eventDate } = await loadFixture(deployFixture);
      await time.increaseTo(eventDate - 12n * 3600n);
      await expect(
        ticketNFT.connect(seller).listForResale(1, ethers.parseEther("0.05"))
      ).to.be.revertedWith("Resale locked");
    });

    it("a buyer already holding 4 tickets for the event can still buy one through buyResale", async function () {
      // Known limitation: the MAX_TICKETS_PER_WALLET (4) limit is only enforced in buyTicket(),
      // not in buyResale(). A buyer who has already purchased 4 primary tickets can bypass
      // the wallet cap by purchasing additional tickets on the secondary marketplace.
      const { ticketNFT, buyer, seller, faceValue } = await loadFixture(deployFixture);

      // buyer buys 4 primary tickets to hit the wallet limit
      for (let i = 0; i < 4; i++) {
        await ticketNFT.connect(buyer).buyTicket(1, `ipfs://buyer_${i}`, { value: faceValue });
      }

      // 5th primary purchase by buyer reverts with "Wallet limit reached"
      await expect(
        ticketNFT.connect(buyer).buyTicket(1, "ipfs://buyer_overflow", { value: faceValue })
      ).to.be.revertedWith("Wallet limit reached");

      // Seller lists ticket 1 for resale
      const resalePrice = ethers.parseEther("0.055");
      await ticketNFT.connect(seller).listForResale(1, resalePrice);

      // Buyer (already holding 4 tickets) successfully purchases ticket 1 via buyResale
      await ticketNFT.connect(buyer).buyResale(1, { value: resalePrice });
      expect(await ticketNFT.ownerOf(1)).to.equal(buyer.address);
      expect(await ticketNFT.balanceOf(buyer.address)).to.equal(5n);
    });
  });
});
