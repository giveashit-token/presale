import * as anchor from '@coral-xyz/anchor'
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { Program, BN } from '@coral-xyz/anchor'
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, MINT_SIZE, MintLayout, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { BondingCurve } from '../target/types/bonding_curve'
import { calculatePrice, calculatePriceWithDust, calculatePriceSequential } from "../helpers"
import IDL from '../target/idl/bonding_curve.json'
import { join } from 'path'
import { Clock, InstructionErrorCustom, TransactionErrorInstructionError } from 'litesvm/dist/internal';
import { NATIVE_MINT } from '@solana/spl-token';

  
describe('curve init and buy', () => {
  let mint: Keypair
  let mint2: Keypair
  let payer: Keypair
  let program: Program<BondingCurve>
  let svm: LiteSVM
  let programId: PublicKey


  beforeAll(() => {
    svm = new LiteSVM();
    
    // Load the compiled program
    const programPath = join(__dirname, '../target/deploy/bonding_curve.so');
    
    // Program ID from IDL
    programId = new PublicKey(IDL.address);
    
    // Add the program to LiteSVM
    svm.addProgramFromFile(programId, programPath);
  
    
    // Create a payer keypair with lamports
    payer = Keypair.generate();
    svm.setAccount(payer.publicKey, {
      lamports: 1000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    
    // Initialize program (without provider since LiteSVM doesn't use Connection)
    // We'll create transactions manually
    program = new Program<BondingCurve>(IDL as BondingCurve);
    
    // Create mint keypair
    mint = Keypair.generate();
    
    // Initialize the mint account in LiteSVM
    const mintData = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: payer.publicKey,
        supply: BigInt(0),
        decimals: 9,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mintData
    );
    
    const mintLamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
    svm.setAccount(mint.publicKey, {
      lamports: Number(mintLamports),
      data: mintData,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });

    // Create mint keypair
    mint2 = Keypair.generate();
    
    // Initialize the mint account in LiteSVM
    const mint2Data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: payer.publicKey,
        supply: BigInt(0),
        decimals: 9,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mint2Data
    );
    
    const mint2Lamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
    svm.setAccount(mint2.publicKey, {
      lamports: Number(mint2Lamports),
      data: mint2Data,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });
  });

  

  it('Initialize bondingCurve', async () => {
    const [pdaAddress, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );
    const c = svm.getClock()

    // Build the instruction
    const ix = await program.methods
      .initialize(new BN(Number(c.unixTimestamp)))
      .accounts({
        signer: payer.publicKey,
        mint: mint.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        wsolMint: mint2.publicKey
      })
      .instruction();
    
    // Create and send transaction
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer);
    
    // Send the transaction
    const result = svm.sendTransaction(tx);
    console.log("Init result: ", result);
    
    // Check if it's a failed transaction
    if ('err' in result) {
      throw new Error(`Transaction failed: ${result.toString()}`);
    }
    
    
    // Fetch account data from LiteSVM
    const accountInfo = svm.getAccount(pdaAddress);
    if (!accountInfo) {
      throw new Error(`Account ${pdaAddress.toString()} was not created`);
    }


    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const wsol_ata = getAssociatedTokenAddressSync(
      mint2.publicKey,
      dataAccount,
      true,
      programId,
      TOKEN_PROGRAM_ID
    );

    const ataInfo = svm.getAccount(wsol_ata);

    console.log("WSOL ATA: " + ataInfo?.data);
    const ataBalance = program.coder.accounts.decode('wsolTokenAccount', Buffer.from(ataInfo!.data));
    expect(ataBalance.amount.toNumber()).toEqual(0);
    
    // Deserialize the account data using the program (convert Uint8Array to Buffer)
    const currentCount = program.coder.accounts.decode('dataAccount', Buffer.from(accountInfo.data));
    expect(currentCount.sold).toEqual(0);

    
    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp + 10n
    ))

  })

  it('Buy tokens', async () => {
    const nextPayer = Keypair.generate();
    svm.setAccount(nextPayer.publicKey, {
      lamports: 15_000_000_000, // 15 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const [dataAccount, data_bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const [newUserAccount, newUser_bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), nextPayer.publicKey.toBuffer()],
      programId
    );

    const expectedPrice = calculatePrice(0, 20_000_000);
    const initialBalance = svm.getBalance(nextPayer.publicKey);
    const initialDataAccountBalance = svm.getBalance(dataAccount);

    const ix = await program.methods.buyTokens(20_000_000)
      .accounts({
        signer: nextPayer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = nextPayer.publicKey;
    tx.add(ix);
    tx.sign(nextPayer);

    const result = svm.sendTransaction(tx);
    if ('err' in result) {
      throw new Error(`Transaction failed: ${result.meta().prettyLogs()}`);
    }

    const finalBalance = svm.getBalance(nextPayer.publicKey);
    const transactionFee = Number(initialBalance! - finalBalance! - expectedPrice);
    const finalDataAccountBalance = svm.getBalance(dataAccount);

    const userAccountInfo = svm.getAccount(newUserAccount);
    const userAccountData = program.coder.accounts.decode('userAccount', Buffer.from(userAccountInfo!.data));

    expect(userAccountData.boughtTokens).toEqual(new BN(20_000_000).toNumber());
    expect(Number(initialBalance! - finalBalance!) - transactionFee).toEqual(Number(expectedPrice));
    expect(Number(finalDataAccountBalance! - initialDataAccountBalance!)).toEqual(Number(expectedPrice));
  })

  it('Buy from 140mil to 180mil', async () => {
    // First, have 3 different buyers each buy 40mil tokens to reach 140mil total
    // (20mil was already bought in the previous test)
    for (let i = 0; i < 3; i++) {
      const buyer = Keypair.generate();
      svm.setAccount(buyer.publicKey, {
        lamports: 50_000_000_000, // 50 SOL
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });

      const ix = await program.methods.buyTokens(40_000_000)
        .accounts({
          signer: buyer.publicKey,
          wsolMint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction();
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = buyer.publicKey;
      tx.add(ix);
      tx.sign(buyer);

      const result = svm.sendTransaction(tx);
      if ('err' in result) {
        throw new Error(`Buyer ${i + 1} failed: ${result.meta().prettyLogs()}`);
      }
    }

    // Now the 4th buyer buys the final 40mil tokens (at 140mil sold)
    const buyer2 = Keypair.generate();
    svm.setAccount(buyer2.publicKey, {
      lamports: 500_000_000_000, // 500 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const initialBalance = svm.getBalance(buyer2.publicKey);

    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );
    
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    
    // After test 2 (20mil) + 3 buyers (3x40mil = 120mil) = 140mil total
    expect(bought).toEqual(140_000_000);
    const expectedPrice = calculatePrice(bought, 40_000_000);
    const initialDataAccountBalance = svm.getBalance(dataAccount);

    const ix = await program.methods.buyTokens(40_000_000)
      .accounts({
        signer: buyer2.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer2.publicKey;
    tx.add(ix);
    tx.sign(buyer2);

    const result = svm.sendTransaction(tx);
    if ('err' in result) {
      throw new Error(`Final buyer failed: ${result.meta().prettyLogs()}`);
    }

    const finalBalance = svm.getBalance(buyer2.publicKey);
    const transactionFee = Number(initialBalance! - finalBalance! - expectedPrice);
    const finalDataAccountBalance = svm.getBalance(dataAccount);

    const [user2Account] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), buyer2.publicKey.toBuffer()],
      programId
    );

    const userAccountInfo = svm.getAccount(user2Account);
    const userAccountData = program.coder.accounts.decode('userAccount', Buffer.from(userAccountInfo!.data));

    expect(userAccountData.boughtTokens).toEqual(new BN(40_000_000).toNumber());
    expect(Number(initialBalance! - finalBalance!) - transactionFee).toEqual(Number(expectedPrice));
    expect(Number(finalDataAccountBalance! - initialDataAccountBalance!)).toEqual(Number(expectedPrice));
  })

  it('Should fail with insufficient funds', async () => {
    const poorBuyer = Keypair.generate();
    svm.setAccount(poorBuyer.publicKey, {
      lamports: 12_000_000, // 0.001 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const initialDataAccountBalance = svm.getBalance(dataAccount);

    const ix = await program.methods.buyTokens(10_000_000)
      .accounts({
        signer: poorBuyer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = poorBuyer.publicKey;
    tx.add(ix);
    tx.sign(poorBuyer);

    const result = svm.sendTransaction(tx);

    const finalDataAccountBalance = svm.getBalance(dataAccount);
    expect(finalDataAccountBalance).toEqual(initialDataAccountBalance);

    expect(result instanceof FailedTransactionMetadata).toBe(true);
    expect((
      ((result as FailedTransactionMetadata)
      .err() as TransactionErrorInstructionError)
      .err() as InstructionErrorCustom)
      .code).toBe(6004);
  })

  it('should fail with zero tokens to buy', async () => {
    const buyer = Keypair.generate();
    svm.setAccount(buyer.publicKey, {
      lamports: 1_000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const ix = await program.methods.buyTokens(0)
      .accounts({
        signer: buyer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer.publicKey;
    tx.add(ix);
    tx.sign(buyer);

    const result = svm.sendTransaction(tx);
    expect(result instanceof FailedTransactionMetadata).toBe(true);
    expect((
      ((result as FailedTransactionMetadata)
      .err() as TransactionErrorInstructionError)
      .err() as InstructionErrorCustom)
      .code).toBe(6006);
  })

  it('Fail to exceed max tokens per user', async () => {
    const buyer = Keypair.generate();
    svm.setAccount(buyer.publicKey, {
      lamports: 1_000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const initialDataAccountBalance = svm.getBalance(dataAccount);
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    expect(bought).toEqual(180_000_000);
    const expectedPrice = calculatePrice(bought, 40_000_000);

    const ix = await program.methods.buyTokens(40_000_000)
      .accounts({
        signer: buyer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer.publicKey;
    tx.add(ix);
    tx.sign(buyer);

    const result = svm.sendTransaction(tx);

    const finalDataAccountBalance = svm.getBalance(dataAccount);
    expect(finalDataAccountBalance! - initialDataAccountBalance!).toEqual(expectedPrice);

    const [userAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), buyer.publicKey.toBuffer()],
      programId
    );


    const userAccountInfo = svm.getAccount(userAccount);
    const userAccountData = program.coder.accounts.decode('userAccount', Buffer.from(userAccountInfo!.data));
    const userBought = userAccountData.boughtTokens;
    expect(userBought).toEqual(40_000_000);

    const ix2 = await program.methods.buyTokens(1_000_000)
      .accounts({
        signer: buyer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx2 = new Transaction();
    tx2.recentBlockhash = svm.latestBlockhash();
    tx2.feePayer = buyer.publicKey;
    tx2.add(ix2);
    tx2.sign(buyer);
    const result2 = svm.sendTransaction(tx2);

    expect(result2 instanceof FailedTransactionMetadata).toBe(true);
    expect((
      ((result2 as FailedTransactionMetadata)
      .err() as TransactionErrorInstructionError)
      .err() as InstructionErrorCustom)
      .code).toBe(6002);
  })

  it('Reduce amount to buy when requested more than available', async () => {
    for (let i = 0; i < 4; i++) {
      const buyer = Keypair.generate();
      svm.setAccount(buyer.publicKey, {
        lamports: 1_000_000_000_000, // 1000 SOL
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });

      const ix = await program.methods.buyTokens(40_000_000)
        .accounts({
          signer: buyer.publicKey,
          wsolMint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction();
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = buyer.publicKey;
      tx.add(ix);
      tx.sign(buyer);

      const result = svm.sendTransaction(tx);
    }
    
    const finalBuyer = Keypair.generate();
    svm.setAccount(finalBuyer.publicKey, {
      lamports: 1_000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const initialBalance = svm.getBalance(finalBuyer.publicKey);
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    const initialDataAccountBalance = svm.getBalance(dataAccount);

    const ix = await program.methods.buyTokens(40_000_000)
      .accounts({
        signer: finalBuyer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = finalBuyer.publicKey;
    tx.add(ix);
    tx.sign(finalBuyer);

    svm.sendTransaction(tx);

    const finalBalance = svm.getBalance(finalBuyer.publicKey);
    const pricePaid = Number((svm.getBalance(dataAccount)! - initialDataAccountBalance!));
    const transactionFee = Number(initialBalance! - finalBalance!) - pricePaid;
    expect(Number(initialBalance! - finalBalance!) - transactionFee).toEqual(pricePaid);

    const [newUserAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), finalBuyer.publicKey.toBuffer()],
      programId
    );

    const userAccountInfo = svm.getAccount(newUserAccount);
    const userAccountData = program.coder.accounts.decode('userAccount', Buffer.from(userAccountInfo!.data));

    expect(userAccountData.boughtTokens).toEqual(new BN(20_000_000).toNumber());

    const finalDataBalance = svm.getBalance(dataAccount);
    expect(Number(finalDataBalance! - initialDataAccountBalance!)).toEqual(pricePaid);
    
  })

  it('Fail to buy when sold out', async () => {
    const buyer = Keypair.generate();
    svm.setAccount(buyer.publicKey, {
      lamports: 1_000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    expect(bought).toEqual(400_000_000); // Confirm sold out

    const ix = await program.methods.buyTokens(1_000_000)
      .accounts({
        signer: buyer.publicKey,
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer.publicKey;
    tx.add(ix);
    tx.sign(buyer);
    
    const result = svm.sendTransaction(tx);
    expect(result instanceof FailedTransactionMetadata).toBe(true);
    expect((
      ((result as FailedTransactionMetadata)
      .err() as TransactionErrorInstructionError)
      .err() as InstructionErrorCustom)
      .code).toBe(6003);
  })

  it('Check final state of data account', async () => {
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const dataAccountLamports = svm.getBalance(dataAccount);

    // Simulate the exact purchase sequence performed in the tests to capture per-call rounding loss
    // 1x20m, 9x40m, 1x20m
    const purchasePlan = [
      20_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      40_000_000,
      20_000_000,
    ];

    const expectedTotal = calculatePriceSequential(0, purchasePlan);

    expect(dataAccountData.sold).toEqual(400_000_000);
    expect(dataAccountData.depositedSol.toNumber()).toEqual(Number(expectedTotal));
    expect(dataAccountData.depositedSol.toNumber()).toEqual(new BN(171428571428).toNumber());
    expect(dataAccountLamports).toBeGreaterThanOrEqual(171428571428);
  })

})

describe('curve init and buy in small amount', () => {
  let mint: Keypair
  let payer: Keypair
  let program: Program<BondingCurve>
  let svm: LiteSVM
  let programId: PublicKey


  beforeAll(() => {
    svm = new LiteSVM();
    
    // Load the compiled program
    const programPath = join(__dirname, '../target/deploy/bonding_curve.so');
    
    // Program ID from IDL
    programId = new PublicKey(IDL.address);
    
    // Add the program to LiteSVM
    svm.addProgramFromFile(programId, programPath);
    
    // Create a payer keypair with lamports
    payer = Keypair.generate();
    svm.setAccount(payer.publicKey, {
      lamports: 1000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    
    // Initialize program (without provider since LiteSVM doesn't use Connection)
    // We'll create transactions manually
    program = new Program<BondingCurve>(IDL as BondingCurve);
    
    // Create mint keypair
    mint = Keypair.generate();
    
    // Initialize the mint account in LiteSVM
    const mintData = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: payer.publicKey,
        supply: BigInt(0),
        decimals: 9,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mintData
    );
    
    const mintLamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
    svm.setAccount(mint.publicKey, {
      lamports: Number(mintLamports),
      data: mintData,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });
    
  });

  it('Initialize bondingCurve', async () => {
    const [pdaAddress, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );
    const c = svm.getClock()

    // Build the instruction
    const ix = await program.methods
      .initialize(new BN(Number(c.unixTimestamp)))
      .accounts({
        signer: payer.publicKey,
        mint: mint.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        wsolMint: NATIVE_MINT
      })
      .instruction();
    
    // Create and send transaction
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer);
    
    // Send the transaction
    const result = svm.sendTransaction(tx);
    
    // Check if it's a failed transaction
    if ('err' in result) {
      throw new Error(`Transaction failed: ${result.toString()}`);
    }
    
    
    // Fetch account data from LiteSVM
    const accountInfo = svm.getAccount(pdaAddress);
    if (!accountInfo) {
      throw new Error(`Account ${pdaAddress.toString()} was not created`);
    }
    
    // Deserialize the account data using the program (convert Uint8Array to Buffer)
    const currentCount = program.coder.accounts.decode('dataAccount', Buffer.from(accountInfo.data));
    expect(currentCount.sold).toEqual(0);

    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp + 10n
    ))
  })

  it('Buy 400 x 1,000,000 tokens', async () => {
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const initialDataAccountBalance = svm.getBalance(dataAccount);

    let acculumulatedPrice = 0n;
    for (let i = 0; i < 10; i++) {
      const buyer = Keypair.generate();
      svm.setAccount(buyer.publicKey, {
        lamports: 50_000_000_000,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });

      const ix = await program.methods.buyTokens(40_000_000)
        .accounts({
          signer: buyer.publicKey,
          wsolMint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction();
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = buyer.publicKey;
      tx.add(ix);
      tx.sign(buyer);

      const result = svm.sendTransaction(tx);
      if ('err' in result) {
        throw new Error(`Buyer ${i + 1} failed: ${result.meta().prettyLogs()}`);
      }
      const price = calculatePrice(i * 40_000_000, 40_000_000);
      acculumulatedPrice += price;
    }

    const finalDataAccountBalance = svm.getBalance(dataAccount);
    
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    
    expect(bought).toEqual(400_000_000);
    const dataAccountBalance = svm.getBalance(dataAccount);
    expect(Number(finalDataAccountBalance! - initialDataAccountBalance!)).toBeCloseTo(Number(calculatePrice(0, 400_000_000)), -2);
  })

})

describe('curve init and buy in random amounts', () => {
  let mint: Keypair
  let payer: Keypair
  let program: Program<BondingCurve>
  let svm: LiteSVM
  let programId: PublicKey


  beforeAll(() => {
    svm = new LiteSVM();
    
    // Load the compiled program
    const programPath = join(__dirname, '../target/deploy/bonding_curve.so');
    
    // Program ID from IDL
    programId = new PublicKey(IDL.address);
    
    // Add the program to LiteSVM
    svm.addProgramFromFile(programId, programPath);
    
    // Create a payer keypair with lamports
    payer = Keypair.generate();
    svm.setAccount(payer.publicKey, {
      lamports: 1000_000_000_000, // 1000 SOL
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    
    // Initialize program (without provider since LiteSVM doesn't use Connection)
    // We'll create transactions manually
    program = new Program<BondingCurve>(IDL as BondingCurve);
    
    // Create mint keypair
    mint = Keypair.generate();
    
    // Initialize the mint account in LiteSVM
    const mintData = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: payer.publicKey,
        supply: BigInt(0),
        decimals: 9,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      mintData
    );
    
    const mintLamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
    svm.setAccount(mint.publicKey, {
      lamports: Number(mintLamports),
      data: mintData,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });
    
  });

  it('Initialize bondingCurve', async () => {
    const [pdaAddress, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const c = svm.getClock()

    // Build the instruction
    const ix = await program.methods
      .initialize(new BN(Number(c.unixTimestamp)))
      .accounts({
        signer: payer.publicKey,
        mint: mint.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        wsolMint: NATIVE_MINT
      })
      .instruction();
    
    // Create and send transaction
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer);
    
    // Send the transaction
    const result = svm.sendTransaction(tx);
    
    // Check if it's a failed transaction
    if ('err' in result) {
      throw new Error(`Transaction failed: ${result.toString()}`);
    }
    
    
    // Fetch account data from LiteSVM
    const accountInfo = svm.getAccount(pdaAddress);
    if (!accountInfo) {
      throw new Error(`Account ${pdaAddress.toString()} was not created`);
    }
    
    // Deserialize the account data using the program (convert Uint8Array to Buffer)
    const currentCount = program.coder.accounts.decode('dataAccount', Buffer.from(accountInfo.data));
    expect(currentCount.sold).toEqual(0);

    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp + 10n
    ))
  })

  it('Buys one token multiple times', async () => {
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const initialDataAccountBalance = svm.getBalance(dataAccount);
    const initialDataAccountInfo = svm.getAccount(dataAccount);
    const initialDataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(initialDataAccountInfo!.data));
    const initialBought = initialDataAccountData.sold;


    for (let i = 0; i < 1000; i++) {
      const buyer = Keypair.generate();
      svm.setAccount(buyer.publicKey, {
        lamports: 1_000_000_000,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });

      const ix = await program.methods.buyTokens(1)
        .accounts({
          signer: buyer.publicKey,
          wsolMint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction();
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = buyer.publicKey;
      tx.add(ix);
      tx.sign(buyer);

      const result = svm.sendTransaction(tx);
      if ('err' in result) {
        throw new Error(`Buyer ${i + 1} failed: ${result.meta().prettyLogs()}`);
      }
    }

    const finalDataAccountBalance = svm.getBalance(dataAccount);
    
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    
    expect(bought).toEqual(initialBought + 1000);
    expect(Number(finalDataAccountBalance! - initialDataAccountBalance!)).toBeCloseTo(Number(calculatePrice(initialBought, 1000)), -3);
  })

  it('Buy random amounts of tokens', async () => {
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const initialDataAccountBalance = svm.getBalance(dataAccount);
    const rent = svm.minimumBalanceForRentExemption(BigInt(program.account.dataAccount.size));
    const iterations = Math.floor(Math.random() * 20) + 1;
    const initialInfo = svm.getAccount(dataAccount);
    const initialData = program.coder.accounts.decode('dataAccount', Buffer.from(initialInfo!.data));
    const initialDepositedSol = initialData.depositedSol.toNumber();

    expect(Number(initialDataAccountBalance! - rent)).toEqual(initialDepositedSol);

    for (let i = 0; i < iterations; i++) {
      const buyer = Keypair.generate();
      svm.setAccount(buyer.publicKey, {
        lamports: 50_000_000_000,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });

      const amountToBuy = Math.floor(Math.random() * 40_000_000);

      const ix = await program.methods.buyTokens(amountToBuy)
        .accounts({
          signer: buyer.publicKey,
          wsolMint: NATIVE_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction();
      tx.recentBlockhash = svm.latestBlockhash();
      tx.feePayer = buyer.publicKey;
      tx.add(ix);
      tx.sign(buyer);

      const result = svm.sendTransaction(tx);
      if ('err' in result) {
        throw new Error(`Buyer ${i + 1} failed: ${result.meta().prettyLogs()}`);
      }
      // We rely on program's depositedSol consistency for this randomized test
    }

    const finalDataAccountBalance = svm.getBalance(dataAccount);
    
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));
    const bought = dataAccountData.sold;
    const expectedTotal = dataAccountData.depositedSol.toNumber() - initialDepositedSol;
    expect(Number(finalDataAccountBalance! - initialDataAccountBalance!)).toEqual(Number(expectedTotal));
  })

})