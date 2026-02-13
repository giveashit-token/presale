import * as anchor from '@coral-xyz/anchor'
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { Program, BN } from '@coral-xyz/anchor'
import { Keypair, PublicKey, Transaction, SystemProgram, Message } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, MINT_SIZE, MintLayout, getMintLen, TOKEN_2022_PROGRAM_ID, createInitializeTransferFeeConfigInstruction, createInitializeMintInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createMintToInstruction, unpackAccount, ASSOCIATED_TOKEN_PROGRAM_ID, withdrawWithheldTokensFromAccountsInstructionData, createWithdrawWithheldTokensFromAccountsInstruction } from '@solana/spl-token'
import { BondingCurve } from '../target/types/bonding_curve'
import {calculatePrice} from "../helpers"
import IDL from '../target/idl/bonding_curve.json'
import { join } from 'path'
import { Clock, InstructionErrorCustom, TransactionErrorInstructionError, TransactionMetadata } from 'litesvm/dist/internal';
import { extension, ExtensionType, getMintSize, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { getCreateAccountInstruction } from "@solana-program/system";
import { generateKeyPairSigner, KeyPairSigner } from '@solana/kit';

describe('curve init and mint', () => {
  let mint: Keypair
  let payer: Keypair
  let program: Program<BondingCurve>
  let svm: LiteSVM
  let programId: PublicKey
  let tokensAccounts: PublicKey[] = [];


  beforeAll(async () => {
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

    // Calculate space needed for mint with TransferFeeConfig extension
    // @ts-ignore
    const space = getMintLen([ExtensionType.TransferFeeConfig]);

    const rent = svm.minimumBalanceForRentExemption(BigInt(space));
    // Create mint keypair
    mint = Keypair.generate();

    const createAccountIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: Number(space),
        lamports: Number(rent),
        programId: TOKEN_2022_PROGRAM_ID,
    });

    const initTransferFeeIx = createInitializeTransferFeeConfigInstruction(
        mint.publicKey,
        payer.publicKey,
        payer.publicKey,
        100, // 100 basis points = 1%
        BigInt(2**64 - 1), // Max fee
        TOKEN_2022_PROGRAM_ID
    );

    const initMintIx = createInitializeMintInstruction(
        mint.publicKey,
        9, // decimals
        payer.publicKey, // mint authority
        null, // freeze authority
        TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction();
    tx.add(createAccountIx, initTransferFeeIx, initMintIx);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer, mint);
    
    const txResult = svm.sendTransaction(tx);
    expect(txResult instanceof TransactionMetadata).toBe(true);

    // Init the curve



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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();
    
    // Create and send transaction
    const tx2 = new Transaction();
    tx2.recentBlockhash = svm.latestBlockhash();
    tx2.feePayer = payer.publicKey;
    tx2.add(ix);
    tx2.sign(payer);
    
    // Send the transaction
    const result = svm.sendTransaction(tx2);

    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp + 10n
    ))
    
    // Check if it's a failed transaction
    if ('err' in result) {
        throw new Error(`Transaction failed: ${result.toString()}`);
    }
    
    
    // Fetch account data from LiteSVM
    const accountInfo = svm.getAccount(pdaAddress);
    if (!accountInfo) {
        throw new Error(`Account ${pdaAddress.toString()} was not created`);
    }


  });

  it('should mint tokens to curve treasury', async () => {
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );
    
    const [curveTokenAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from("curve_token_treasury"), dataAccount.toBuffer()],
      programId
    )

    const mintAmount = 400_000_000_000_000_000n;

    const mintToIx = createMintToInstruction(
        mint.publicKey,
        curveTokenAddress,
        payer.publicKey,
        mintAmount,
        [], // no multisig signers
        TOKEN_2022_PROGRAM_ID
    );
    const tx = new Transaction().add(mintToIx);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer);

    const result = svm.sendTransaction(tx);

    expect(result instanceof TransactionMetadata).toBe(true);

    // 7. Verify token account balance
    const curveTokenAccountData = svm.getAccount(curveTokenAddress);
    expect(curveTokenAccountData).not.toBeNull();

    const tokenAccount = unpackAccount(
        curveTokenAddress, 
        // @ts-ignore
        curveTokenAccountData!, 
        TOKEN_2022_PROGRAM_ID
    );

    expect(Number(tokenAccount.amount)).toEqual(Number(mintAmount));
    expect(tokenAccount.mint).toEqual(mint.publicKey);
    expect(tokenAccount.owner).toEqual(dataAccount);
  });

  it('should mint tokens to pool treasury', async () => {
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const [poolTokenAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_token_treasury"), dataAccount.toBuffer()],
      programId
    )

    const mintAmount = 200_000_000_000_000_000n;

    const mintToIx = createMintToInstruction(
        mint.publicKey,
        poolTokenAddress,
        payer.publicKey,
        mintAmount,
        [], // no multisig signers
        TOKEN_2022_PROGRAM_ID
    );
    const tx = new Transaction().add(mintToIx);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.sign(payer);

    const result = svm.sendTransaction(tx);

    expect(result instanceof TransactionMetadata).toBe(true);

    // 7. Verify token account balance
    const poolTokenAccountData = svm.getAccount(poolTokenAddress);
    expect(poolTokenAccountData).not.toBeNull();

    const tokenAccount = unpackAccount(
        poolTokenAddress, 
        // @ts-ignore
        poolTokenAccountData!, 
        TOKEN_2022_PROGRAM_ID
    );

    expect(Number(tokenAccount.amount)).toEqual(Number(mintAmount));
    expect(tokenAccount.mint).toEqual(mint.publicKey);
    expect(tokenAccount.owner).toEqual(dataAccount);

  })

  it('should fail with claim not yet available', async () => {
    const buyer = Keypair.generate();
    const tokensToBuy = 1_000_000;

    svm.setAccount(buyer.publicKey, {
    lamports: 1_000_000_000,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
    });

    const ix = await program.methods.buyTokens(tokensToBuy)
    .accounts({
        signer: buyer.publicKey,
    })
    .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer.publicKey;
    tx.add(ix);
    tx.sign(buyer);

    const result = svm.sendTransaction(tx);
    expect(result instanceof TransactionMetadata).toBe(true);

    const c = svm.getClock()

    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp + 60n * 60n * 24n * 2n 
    ))

    const ix2 = await program.methods.claimTokens()
    .accounts({
      // @ts-ignore
        user: buyer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        mint: mint.publicKey,
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
      .code).toBe(6000);
  });

  it('should buy and claim tokens', async () => {
    const buyer = Keypair.generate();
    const tokensToBuy = 1_000_000;

    svm.setAccount(buyer.publicKey, {
    lamports: 1_000_000_000,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
    });

    const c0 = svm.getClock()
    svm.setClock(new Clock(
      c0.slot,
      c0.epochStartTimestamp,
      c0.epoch,
      c0.leaderScheduleEpoch,
      c0.unixTimestamp - 60n * 60n * 24n * 2n 
    ))

    const ix = await program.methods.buyTokens(tokensToBuy)
    .accounts({
        signer: buyer.publicKey,
    })
    .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer.publicKey;
    tx.add(ix);
    tx.sign(buyer);

    const result = svm.sendTransaction(tx);
    expect(result instanceof TransactionMetadata).toBe(true);

    const c = svm.getClock()

    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp + 60n * 60n * 24n * 4n 
    ))

    const ix2 = await program.methods.claimTokens()
    .accounts({
      // @ts-ignore
        user: buyer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        mint: mint.publicKey,
    })
    .instruction();
    const tx2 = new Transaction();
    tx2.recentBlockhash = svm.latestBlockhash();
    tx2.feePayer = buyer.publicKey;
    tx2.add(ix2);
    tx2.sign(buyer);

    const result2 = svm.sendTransaction(tx2);
    expect(result2 instanceof TransactionMetadata).toBe(true);

    const buyerTokenAddress = getAssociatedTokenAddressSync(
        mint.publicKey,
        buyer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokensAccounts.push(buyerTokenAddress);

    const buyerTokenAccountData = svm.getAccount(buyerTokenAddress);
    expect(buyerTokenAccountData).not.toBeNull();

    const tokenAccount = unpackAccount(
        buyerTokenAddress, 
        // @ts-ignore
        buyerTokenAccountData!, 
        TOKEN_2022_PROGRAM_ID
    );
    
    const [dataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("data")],
      programId
    );

    const [buyerAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), buyer.publicKey.toBuffer()],
      programId
    );
    const dataAccountInfo = svm.getAccount(dataAccount);
    const dataAccountData = program.coder.accounts.decode('dataAccount', Buffer.from(dataAccountInfo!.data));

    const buyerAccountInfo = svm.getAccount(buyerAccount);
    const buyerAccountData = program.coder.accounts.decode('userAccount', Buffer.from(buyerAccountInfo!.data));

    const c2 = svm.getClock()

    const tokensToClaim = Math.floor((Number(buyerAccountData.boughtTokens) * (Number(c2.unixTimestamp)
     - Number(dataAccountData.cliffTime))) / (Number(dataAccountData.claimEnd) - Number(dataAccountData.cliffTime)));

    expect(Number(tokenAccount.amount)).toEqual(tokensToClaim);
    expect(tokenAccount.mint).toEqual(mint.publicKey);
    expect(tokenAccount.owner).toEqual(buyer.publicKey);
  });

  it('should fail with no tokens left to claim', async () => {
    const buyer = Keypair.generate();
    const tokensToBuy = 1_000_000;

    svm.setAccount(buyer.publicKey, {
    lamports: 1_000_000_000,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
    });

    const c = svm.getClock()
    
    svm.setClock(new Clock(
      c.slot,
      c.epochStartTimestamp,
      c.epoch,
      c.leaderScheduleEpoch,
      c.unixTimestamp - 60n * 60n * 24n * 4n 
    ))

    const ix = await program.methods.buyTokens(tokensToBuy)
    .accounts({
        signer: buyer.publicKey,
    })
    .instruction();

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = buyer.publicKey;
    tx.add(ix);
    tx.sign(buyer);

    const result = svm.sendTransaction(tx);
    expect(result instanceof TransactionMetadata).toBe(true);

    const c2 = svm.getClock()
    
    svm.setClock(new Clock(
      c2.slot,
      c2.epochStartTimestamp,
      c2.epoch,
      c2.leaderScheduleEpoch,
      c2.unixTimestamp + 60n * 60n * 24n * 15n 
    ))

    const ix2 = await program.methods.claimTokens()
    .accounts({
      // @ts-ignore
        user: buyer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        mint: mint.publicKey,
    })
    .instruction();
    const tx2 = new Transaction();
    tx2.recentBlockhash = svm.latestBlockhash();
    tx2.feePayer = buyer.publicKey;
    tx2.add(ix2);
    tx2.sign(buyer);

    const result2 = svm.sendTransaction(tx2);
    expect(result2 instanceof TransactionMetadata).toBe(true);

    const buyerTokenAddress = getAssociatedTokenAddressSync(
        mint.publicKey,
        buyer.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokensAccounts.push(buyerTokenAddress);

    const buyerTokenAccountData = svm.getAccount(buyerTokenAddress);
    expect(buyerTokenAccountData).not.toBeNull();

    const tokenAccount = unpackAccount(
        buyerTokenAddress, 
        // @ts-ignore
        buyerTokenAccountData!, 
        TOKEN_2022_PROGRAM_ID
    );

    expect(Number(tokenAccount.amount)).toEqual(tokensToBuy);
    expect(tokenAccount.mint).toEqual(mint.publicKey);
    expect(tokenAccount.owner).toEqual(buyer.publicKey);
    svm.expireBlockhash();

    // Try to claim again, should fail
    const ix3 = await program.methods.claimTokens()
    .accounts({
      // @ts-ignore
        user: buyer.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        mint: mint.publicKey,
    })
    .instruction();
    const tx3 = new Transaction();
    tx3.recentBlockhash = svm.latestBlockhash();
    tx3.feePayer = buyer.publicKey;
    tx3.add(ix3);
    tx3.sign(buyer);

    const result3 = svm.sendTransaction(tx3);
    expect(result3 instanceof FailedTransactionMetadata).toBe(true);
    expect((
      ((result3 as FailedTransactionMetadata)
      .err() as TransactionErrorInstructionError)
      .err() as InstructionErrorCustom)
      .code).toBe(6001);
  });

});