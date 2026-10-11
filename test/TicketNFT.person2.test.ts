import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { TicketNFTHarness } from "../typechain-types";

describe("TicketNFT Person 2", function () {
  async function deployFixture() {
    const [deployer, organizer, seller, buyer, other] = await ethers.getSigners();

    const harness = (await ethers.deployContract("TicketNFTHarness")) as unknown as TicketNFTHarness;

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

    // Mint ticket 1 to seller
    await harness.mintForTest(seller.address, 1);

    return {
      harness,
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

  describe("maxResalePrice and listing", function () {
    it("maxResalePrice equals 0.06 ETH", async function () {
      const { harness } = await loadFixture(deployFixture);
      expect(await harness.maxResalePrice(1)).to.equal(ethers.parseEther("0.06"));
    });

    it("list exactly at cap", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      const cap = ethers.parseEther("0.06");
      await expect(harness.connect(seller).listForResale(1, cap))
        .to.emit(harness, "Listed")
        .withArgs(1, seller.address, cap);
      expect(await harness.listings(1)).to.equal(cap);
    });

    it("cap + 1 wei reverts 'Above cap'", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      const cap = ethers.parseEther("0.06");
      await expect(
        harness.connect(seller).listForResale(1, cap + 1n)
      ).to.be.revertedWith("Above cap");
    });

    it("price 0 reverts 'Bad price'", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      await expect(
        harness.connect(seller).listForResale(1, 0)
      ).to.be.revertedWith("Bad price");
    });

    it("non-owner reverts 'Not owner'", async function () {
      const { harness, other } = await loadFixture(deployFixture);
      const cap = ethers.parseEther("0.06");
      await expect(
        harness.connect(other).listForResale(1, cap)
      ).to.be.revertedWith("Not owner");
    });

    it("12 hours before the event reverts 'Resale locked'", async function () {
      const { harness, seller, eventDate } = await loadFixture(deployFixture);
      await time.increaseTo(eventDate - 12n * 3600n);
      await expect(
        harness.connect(seller).listForResale(1, ethers.parseEther("0.05"))
      ).to.be.revertedWith("Resale locked");
    });

    it("used ticket reverts 'Ticket used'", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      await harness.markUsedForTest(1);
      await expect(
        harness.connect(seller).listForResale(1, ethers.parseEther("0.05"))
      ).to.be.revertedWith("Ticket used");
    });

    it("third resale reverts 'Max resales reached'", async function () {
      const { harness, seller, buyer, other } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");

      // Resale 1: seller -> buyer
      await harness.connect(seller).listForResale(1, price);
      await harness.connect(buyer).buyResale(1, { value: price });

      // Resale 2: buyer -> other
      await harness.connect(buyer).listForResale(1, price);
      await harness.connect(other).buyResale(1, { value: price });

      // Resale 3: other attempts to list -> blocked
      await expect(
        harness.connect(other).listForResale(1, price)
      ).to.be.revertedWith("Max resales reached");
    });
  });

  describe("cancelListing", function () {
    it("cancel by owner", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");
      await harness.connect(seller).listForResale(1, price);
      await expect(harness.connect(seller).cancelListing(1))
        .to.emit(harness, "ListingCancelled")
        .withArgs(1);
      expect(await harness.listings(1)).to.equal(0n);
    });

    it("cancel when unlisted", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      await expect(
        harness.connect(seller).cancelListing(1)
      ).to.be.revertedWith("Not listed");
    });

    it("cancel by non-owner", async function () {
      const { harness, seller, other } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");
      await harness.connect(seller).listForResale(1, price);
      await expect(
        harness.connect(other).cancelListing(1)
      ).to.be.revertedWith("Not owner");
    });

    it("buying a cancelled listing reverts 'Not listed'", async function () {
      const { harness, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.05");
      await harness.connect(seller).listForResale(1, price);
      await harness.connect(seller).cancelListing(1);
      await expect(
        harness.connect(buyer).buyResale(1, { value: price })
      ).to.be.revertedWith("Not listed");
    });
  });

  describe("buyResale", function () {
    it("wrong payment reverts 'Bad payment'", async function () {
      const { harness, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await harness.connect(seller).listForResale(1, price);
      await expect(
        harness.connect(buyer).buyResale(1, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Bad payment");
    });

    it("buying your own ticket reverts 'Own ticket'", async function () {
      const { harness, seller } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await harness.connect(seller).listForResale(1, price);
      await expect(
        harness.connect(seller).buyResale(1, { value: price })
      ).to.be.revertedWith("Own ticket");
    });

    it("buying a used listed ticket reverts 'Ticket used'", async function () {
      const { harness, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      await harness.connect(seller).listForResale(1, price);
      await harness.markUsedForTest(1);
      await expect(
        harness.connect(buyer).buyResale(1, { value: price })
      ).to.be.revertedWith("Ticket used");
    });

    it("successful sale", async function () {
      const { harness, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");
      const royalty = ethers.parseEther("0.0055");

      await harness.connect(seller).listForResale(1, price);

      await expect(harness.connect(buyer).buyResale(1, { value: price }))
        .to.emit(harness, "Sold")
        .withArgs(1, seller.address, buyer.address, price, royalty);

      expect(await harness.ownerOf(1)).to.equal(buyer.address);
      expect(await harness.listings(1)).to.equal(0n);
      expect(await harness.resaleCount(1)).to.equal(1);
    });
  });

  describe("royalty and rounding", function () {
    it("pending balances after a 0.055 ETH sale", async function () {
      const { harness, organizer, seller, buyer } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.055");

      await harness.connect(seller).listForResale(1, price);
      await harness.connect(buyer).buyResale(1, { value: price });

      expect(await harness.pending(organizer.address)).to.equal(ethers.parseEther("0.0055"));
      expect(await harness.pending(seller.address)).to.equal(ethers.parseEther("0.0495"));
    });

    it("the rounding loop for [1n, 7n, 33n, 12345678901234567n, 0.06 ETH]", async function () {
      const { harness, organizer, seller, buyer } = await loadFixture(deployFixture);
      const testPrices = [
        1n,
        7n,
        33n,
        12345678901234567n,
        ethers.parseEther("0.06"),
      ];

      for (let i = 0; i < testPrices.length; i++) {
        const price = testPrices[i];
        const ticketId = BigInt(i + 2);
        await harness.mintForTest(seller.address, 1);

        const prevOrg = await harness.pending(organizer.address);
        const prevSeller = await harness.pending(seller.address);

        await harness.connect(seller).listForResale(ticketId, price);
        await harness.connect(buyer).buyResale(ticketId, { value: price });

        const newOrg = await harness.pending(organizer.address);
        const newSeller = await harness.pending(seller.address);

        const delta = (newOrg - prevOrg) + (newSeller - prevSeller);
        expect(delta).to.equal(price);
      }
    });
  });

  describe("transfer lock", function () {
    it("transferFrom by owner", async function () {
      const { harness, seller, buyer } = await loadFixture(deployFixture);
      await expect(
        harness.connect(seller).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("safeTransferFrom by owner", async function () {
      const { harness, seller, buyer } = await loadFixture(deployFixture);
      await expect(
        harness
          .connect(seller)
          ["safeTransferFrom(address,address,uint256)"](
            seller.address,
            buyer.address,
            1
          )
      ).to.be.revertedWith("Use marketplace");
    });

    it("operator after approve", async function () {
      const { harness, seller, buyer, other } = await loadFixture(deployFixture);
      await harness.connect(seller).approve(other.address, 1);
      await expect(
        harness.connect(other).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("operator after setApprovalForAll", async function () {
      const { harness, seller, buyer, other } = await loadFixture(deployFixture);
      await harness.connect(seller).setApprovalForAll(other.address, true);
      await expect(
        harness.connect(other).transferFrom(seller.address, buyer.address, 1)
      ).to.be.revertedWith("Use marketplace");
    });

    it("minting still works", async function () {
      const { harness, buyer } = await loadFixture(deployFixture);
      await harness.mintForTest(buyer.address, 1);
      expect(await harness.ownerOf(2)).to.equal(buyer.address);
    });
  });

  describe("withdraw", function () {
    async function saleFixture() {
      const base = await deployFixture();
      const price = ethers.parseEther("0.055");
      await base.harness.connect(base.seller).listForResale(1, price);
      await base.harness.connect(base.buyer).buyResale(1, { value: price });
      return { ...base, price };
    }

    it("withdraw pays the seller exactly", async function () {
      const { harness, seller } = await loadFixture(saleFixture);
      const expectedSellerAmount = ethers.parseEther("0.0495");

      await expect(harness.connect(seller).withdraw()).to.changeEtherBalance(
        seller,
        expectedSellerAmount
      );
      expect(await harness.pending(seller.address)).to.equal(0n);
    });

    it("withdraw pays the organizer exactly", async function () {
      const { harness, organizer } = await loadFixture(saleFixture);
      const expectedRoyalty = ethers.parseEther("0.0055");

      await expect(harness.connect(organizer).withdraw()).to.changeEtherBalance(
        organizer,
        expectedRoyalty
      );
      expect(await harness.pending(organizer.address)).to.equal(0n);
    });

    it("the Withdrawn event is emitted", async function () {
      const { harness, seller } = await loadFixture(saleFixture);
      const expectedSellerAmount = ethers.parseEther("0.0495");

      await expect(harness.connect(seller).withdraw())
        .to.emit(harness, "Withdrawn")
        .withArgs(seller.address, expectedSellerAmount);
    });

    it("withdraw with zero balance reverts 'Nothing to withdraw'", async function () {
      const { harness, other } = await loadFixture(saleFixture);
      await expect(harness.connect(other).withdraw()).to.be.revertedWith(
        "Nothing to withdraw"
      );
    });

    it("a second withdraw reverts", async function () {
      const { harness, seller } = await loadFixture(saleFixture);
      await harness.connect(seller).withdraw();
      await expect(harness.connect(seller).withdraw()).to.be.revertedWith(
        "Nothing to withdraw"
      );
    });
  });
});
