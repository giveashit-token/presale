use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, SyncNative};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked, BurnChecked};
use raydium_cp_swap::states::{AmmConfig, OBSERVATION_SEED, POOL_LP_MINT_SEED, POOL_SEED, POOL_VAULT_SEED};
use raydium_cp_swap::{cpi};
use raydium_cp_swap::program::RaydiumCpSwap;
use anchor_spl::token::spl_token::native_mint::ID as NATIVE_MINT;

#[cfg(not(feature = "no-entrypoint"))]
use {solana_security_txt::security_txt};

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "GIVEASHIT Presale",
    project_url: "https://giveashit-token.com",
    contacts: "email:info@giveashit-token.com",
    policy: "https://giveashit-token.com/terms",
    preferred_languages: "en",
    source_code: "https://github.com/giveashit-token/app"
}

declare_id!("HakK1rCYDRTKPbxRD3yNRxHtuMfo6ipu947Lw5F6RJmJ");


pub const AUTH_SEED: &str = "vault_and_lp_mint_auth_seed";

// TODO: Update this address when deploying to mainnet
pub const AMM_CONFIG_ADDRESS: &str = "5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy";
pub const RAYDIUM_FEE_ADDRESS: &str = "3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy";
pub const DEV_WALLET_1: &str = "7Y9B1UwX4Rxzb3agv9fB3JMAR1a6pKJP1EYyUcXC416x";
pub const DEV_WALLET_2: &str = "3mfXu7qfUxcv3BWvy1f7dWFRT4t2UiNew62udN5wggNH";

#[program]
pub mod bonding_curve {
    use std::str::FromStr;
    use super::*;

    pub fn initialize(ctx: Context<InitializeCurveContext>, start_time: i64) -> Result<()> {
        *ctx.accounts.data_account = DataAccount {
            admin: *ctx.accounts.signer.key,
            mint: ctx.accounts.mint.key(),
            sold: 0,
            data_bump: ctx.bumps.data_account,
            deposited_sol: 0,
            price_dust: 0,
            start_time: start_time,
            // end_time: start_time + 60 * 60 * 24, // presale lasts for 24 hours
            // claim_end: start_time + 60 * 60 * 24 * 10, // claiming linear over 10 days
            // cliff_time: start_time + 60 * 60 * 24 * 3, // cliff of 3 days
            end_time: start_time + 60 * 30, // presale lasts for 1 hour (test)
            claim_end: start_time + 60 * 60, // claiming linear over 3 hours (test)
            cliff_time: start_time + 60 * 45, // cliff of 2 hours (test)
            pool_created: false,
            authority_bump: ctx.bumps.curve_tokens_authority,
            pool_token_treasury_bump: ctx.bumps.pool_token_treasury,
            curve_token_treasury_bump: ctx.bumps.curve_token_account,
            giveaway_pool_bump: ctx.bumps.giveaway_pool,
        };
        *ctx.accounts.dev_account_1 = DevAccount {
            user: Pubkey::from_str(DEV_WALLET_1).unwrap(),
            claimed: 0,
            // cliff_time: start_time + 60 * 60 * 24 * 365, // cliff of 1 year
            // vesting_end: start_time + 60 * 60 * 24 * 1095, // vesting over 2 years
            cliff_time: start_time + 60 * 75, // cliff of 4 hours (test)
            vesting_end: start_time + 60 * 90, // vesting over 5 hours (test)
            dev_bump: ctx.bumps.dev_account_1,
            dev_pool_bump: ctx.bumps.dev_pool_1,
        };
        *ctx.accounts.dev_account_2 = DevAccount {
            user: Pubkey::from_str(DEV_WALLET_2).unwrap(),
            claimed: 0,
            // cliff_time: start_time + 60 * 60 * 24 * 365, // cliff of 1 year
            // vesting_end: start_time + 60 * 60 * 24 * 1095, // vesting over 2 years
            cliff_time: start_time + 60 * 75, // cliff of 4 hours (test)
            vesting_end: start_time + 60 * 90, // vesting over 5 hours (test)
            dev_bump: ctx.bumps.dev_account_2,
            dev_pool_bump: ctx.bumps.dev_pool_2,
        };
        Ok(())
    }

    pub fn buy_tokens(ctx: Context<BuyTokenContext>, tokens_to_buy: u32) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.user = *ctx.accounts.signer.key;
        user_account.user_bump = ctx.bumps.user_account;
        let data_account = &mut ctx.accounts.data_account;
        let mut tokens_to_buy = tokens_to_buy;
        let now = Clock::get()?.unix_timestamp;

        require!(tokens_to_buy > 0, ErrorCode::NeedToBuyAtLeastOneToken);
        require!(now >= data_account.start_time, ErrorCode::BuyNotAvailableYet);
        require!(now <= data_account.end_time, ErrorCode::BuyPeriodEnded);
        
        const SUPPLY_LIMIT: u32 = 400_000_000;
        const MAX_TOKENS_PER_BUY: u32 = 20_000_000;
        const MAX_TOKENS_PER_USER: u32 = 20_000_000;
        const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

        if tokens_to_buy > MAX_TOKENS_PER_BUY {
            tokens_to_buy = MAX_TOKENS_PER_BUY;
        }
        if data_account.sold.checked_add(tokens_to_buy as u32).ok_or(ErrorCode::OperationOverflowed)? > SUPPLY_LIMIT {
            tokens_to_buy = SUPPLY_LIMIT.saturating_sub(data_account.sold) as u32;
        }
        if tokens_to_buy == 0 {
            return Err(ErrorCode::TokensSoldOut.into());
        }
        if (user_account.bought_tokens as u32).checked_add(tokens_to_buy).ok_or(ErrorCode::OperationOverflowed)? > MAX_TOKENS_PER_USER {
            tokens_to_buy = MAX_TOKENS_PER_USER.saturating_sub(user_account.bought_tokens as u32) as u32;
        }
        if tokens_to_buy == 0 {
            return Err(ErrorCode::MaxTokensToBuyExceeded.into());
        }

        const DECIMALS: u128 = 10u128.pow(18);
        const DIV_REP: u128 = 140;
    
        let a_numerator: u128 = 1 * DECIMALS;
        let a_denominator: u128 = 10u128.pow(13);
        
        let c_numerator: u128 = 4 * DECIMALS;
        let c_denominator: u128 = 10u128.pow(5);

        let factor1 = (data_account.sold as u128)
            .checked_mul(a_numerator)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_div(a_denominator)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_mul(tokens_to_buy as u128)
            .ok_or(ErrorCode::OperationOverflowed)?;

        let factor2 = (tokens_to_buy as u128)
            .checked_mul(tokens_to_buy as u128)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_div(2)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_mul(a_numerator)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_div(a_denominator)
            .ok_or(ErrorCode::OperationOverflowed)?;

        let factor3 = (tokens_to_buy as u128)
            .checked_mul(c_numerator)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_div(c_denominator)
            .ok_or(ErrorCode::OperationOverflowed)?;

        let value = factor1
            .checked_add(factor2)
            .ok_or(ErrorCode::OperationOverflowed)?
            .checked_add(factor3)
            .ok_or(ErrorCode::OperationOverflowed)?;
        
        // Carry remainder (dust) across transactions so that sequential buys
        // sum to the same total as a single batch purchase.
        let numerator = value
            .checked_mul(LAMPORTS_PER_SOL as u128)
            .ok_or(ErrorCode::OperationOverflowed)?;
        let scaled = numerator
            .checked_add(data_account.price_dust)
            .ok_or(ErrorCode::OperationOverflowed)?;
        let divisor = DIV_REP
            .checked_mul(DECIMALS)
            .ok_or(ErrorCode::OperationOverflowed)?;
        let lamports_charged = scaled
            .checked_div(divisor)
            .ok_or(ErrorCode::OperationOverflowed)?;
        let new_dust = scaled
            .checked_rem(divisor)
            .ok_or(ErrorCode::OperationOverflowed)?;

        let lamports_u64 = u64::try_from(lamports_charged)
            .map_err(|_| ErrorCode::OperationOverflowed)?;
        require!(
            ctx.accounts.signer.to_account_info().lamports() > lamports_u64,
            ErrorCode::InsufficientFundsToBuyTokens
        );

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.signer.key(),
            &ctx.accounts.wsol_token_account.key(),
            lamports_u64,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.signer.to_account_info(),
                ctx.accounts.wsol_token_account.to_account_info(),
            ],
        )?;

        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"curve_tokens_authority",
                &[data_account.authority_bump],
            ],
        ];

        token::sync_native(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SyncNative {
                    account: ctx.accounts.wsol_token_account.to_account_info(),
                },
                signer_seeds,
            ),
        )?;

        // Persist new dust so future purchases reclaim fractional lamports.
        data_account.price_dust = new_dust;
        user_account.added_sol = user_account.added_sol + lamports_u64;
        user_account.bought_tokens = user_account.bought_tokens + tokens_to_buy;
        data_account.sold = data_account.sold + tokens_to_buy as u32;
        data_account.deposited_sol = data_account.deposited_sol + lamports_u64;

        Ok(())
    }

    pub fn claim_tokens(ctx: Context<ClaimTokensContext>) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let now = Clock::get()?.unix_timestamp;
        let data_account = &ctx.accounts.data_account;

        require!(now >= data_account.cliff_time, ErrorCode::ClaimNotAvailableYet);

        let time_since_cliff = now.saturating_sub(data_account.cliff_time);
        let total_vesting_duration = data_account.claim_end.saturating_sub(data_account.cliff_time);

        let time_since_cliff_u64 = u64::try_from(time_since_cliff)
            .map_err(|_| ErrorCode::OperationOverflowed)?;
        let total_vesting_u64 = u64::try_from(total_vesting_duration)
            .map_err(|_| ErrorCode::OperationOverflowed)?;

        let vested_amount = if now >= data_account.claim_end {
            user_account.bought_tokens
        } else {
            ((user_account.bought_tokens as u64)
                .checked_mul(time_since_cliff_u64)
                .ok_or(ErrorCode::OperationOverflowed)?
                .checked_div(total_vesting_u64)
                .ok_or(ErrorCode::OperationOverflowed)?) as u32
        };


        let claimable_amount = vested_amount.saturating_sub(user_account.claimed);
        if claimable_amount == 0 {
            return Err(ErrorCode::NothingToClaim.into());
        }

        user_account.claimed = user_account.claimed + claimable_amount as u32;

        let transfer_cpi_accounts = TransferChecked {
            from: ctx.accounts.curve_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.curve_tokens_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"curve_tokens_authority",
                &[ctx.accounts.data_account.authority_bump],
            ],
        ];
        let cpi_context = CpiContext::new(cpi_program, transfer_cpi_accounts).with_signer(
            signer_seeds
        );
        let decimals = ctx.accounts.mint.decimals;
        let amount = u64::try_from(claimable_amount)
            .map_err(|_| ErrorCode::OperationOverflowed)?
            .checked_mul(10u64.pow(decimals as u32))
            .ok_or(ErrorCode::OperationOverflowed)?;
        token_interface::transfer_checked(cpi_context, amount, decimals)?;

        Ok(())
    }

    pub fn init_pool(ctx: Context<InitPoolContext>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        if ctx.accounts.data_account.sold < 400_000_000 && now < ctx.accounts.data_account.end_time {
            return Err(ErrorCode::PresaleNotEnded.into());
        }

        let cpi_accounts = cpi::accounts::Initialize {
            creator: ctx.accounts.curve_tokens_authority.to_account_info(),
            amm_config: ctx.accounts.amm_config.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            token_0_mint: ctx.accounts.token_0_mint.to_account_info(),
            token_1_mint: ctx.accounts.token_1_mint.to_account_info(),
            lp_mint: ctx.accounts.lp_mint.to_account_info(),
            creator_token_0: ctx.accounts.creator_token_0.to_account_info(),
            creator_token_1: ctx.accounts.creator_token_1.to_account_info(),
            creator_lp_token: ctx.accounts.creator_lp_token.to_account_info(),
            token_0_vault: ctx.accounts.token_0_vault.to_account_info(),
            token_1_vault: ctx.accounts.token_1_vault.to_account_info(),
            create_pool_fee: ctx.accounts.create_pool_fee.to_account_info(),
            observation_state: ctx.accounts.observation_state.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_0_program: ctx.accounts.token_0_program.to_account_info(),
            token_1_program: ctx.accounts.token_1_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };

        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"curve_tokens_authority",
                &[ctx.accounts.data_account.authority_bump]
            ]
        ];

        let initialize_ctx = CpiContext::new_with_signer(
            ctx.accounts.cp_swap_program.to_account_info(),
            cpi_accounts,
            signer_seeds);

        let tokens_to_pool = ctx.accounts.data_account.sold / 2;
        let scaled_tokens_to_pool = u64::try_from(tokens_to_pool)
            .map_err(|_| ErrorCode::OperationOverflowed)?
            .checked_mul(10u64.pow(ctx.accounts.token_1_mint.decimals as u32))
            .ok_or(ErrorCode::OperationOverflowed)?;
        let wsol_balance = ctx.accounts.creator_token_0.amount;

        cpi::initialize(initialize_ctx, wsol_balance, scaled_tokens_to_pool, 0)?;

        let data = &mut ctx.accounts.data_account;
        data.pool_created = true;

        Ok(())
    }

    pub fn burn_lp_tokens(ctx: Context<BurnTokensContext>) -> Result<()> {
        require!(ctx.accounts.data_account.pool_created, ErrorCode::PoolNotCreated);

        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"curve_tokens_authority",
                &[ctx.accounts.data_account.authority_bump],
            ],
        ];
        
        let burn_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            BurnChecked {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.creator_lp_token.to_account_info(),
                authority: ctx.accounts.curve_tokens_authority.to_account_info(),
            },
            signer_seeds,
        );

        let decimals = ctx.accounts.lp_mint.decimals;
        let amount = ctx.accounts.creator_lp_token.amount;
        token_interface::burn_checked(burn_ctx, amount, decimals)?;

        let transfer_cpi_accounts = BurnChecked {
            from: ctx.accounts.curve_token_treasury.to_account_info(),
            authority: ctx.accounts.curve_tokens_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            transfer_cpi_accounts,
            signer_seeds
        );
        let decimals = ctx.accounts.mint.decimals;
        let amount = 400_000_000 - ctx.accounts.data_account.sold;
        if amount > 0 {
            let transfer_amount = u64::try_from(amount)
                .map_err(|_| ErrorCode::OperationOverflowed)?
                .checked_mul(10u64.pow(decimals as u32))
                .ok_or(ErrorCode::OperationOverflowed)?;

            token_interface::burn_checked(cpi_context, transfer_amount, decimals)?;
        }

        let burn_curve_tokens_accounts = BurnChecked {
            from: ctx.accounts.pool_token_treasury.to_account_info(),
            authority: ctx.accounts.curve_tokens_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let burn_curve_tokens_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.to_account_info(),
            burn_curve_tokens_accounts,
            signer_seeds
        );

        let curve_amount = ctx.accounts.pool_token_treasury.amount;
        if curve_amount > 0 {
            let transfer_amount = u64::try_from(curve_amount)
                .map_err(|_| ErrorCode::OperationOverflowed)?;

            token_interface::burn_checked(burn_curve_tokens_ctx, transfer_amount, decimals)?;
        }

        Ok(())
    }

    pub fn send_giveaway(ctx: Context<SendGiveawayContext>, amount: u32) -> Result<()> {
        require_keys_eq!(ctx.accounts.signer.key(), ctx.accounts.data_account.admin, ErrorCode::Unauthorized);

        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"curve_tokens_authority",
                &[ctx.accounts.data_account.authority_bump],
            ],
        ];

        let transfer_cpi_accounts = TransferChecked {
            from: ctx.accounts.giveaway_pool.to_account_info(),
            to: ctx.accounts.recipient_ata.to_account_info(),
            authority: ctx.accounts.curve_tokens_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_context = CpiContext::new(cpi_program, transfer_cpi_accounts).with_signer(
            signer_seeds
        );
        let decimals = ctx.accounts.mint.decimals;
        let transfer_amount = u64::try_from(amount)
            .map_err(|_| ErrorCode::OperationOverflowed)?
            .checked_mul(10u64.pow(decimals as u32))
            .ok_or(ErrorCode::OperationOverflowed)?;
        token_interface::transfer_checked(cpi_context, transfer_amount, decimals)?;

        Ok(())
    }

    pub fn dev_claim(ctx: Context<DevClaimContext>) -> Result<()> {
        if ctx.accounts.user.key() != Pubkey::from_str(DEV_WALLET_1).unwrap() && ctx.accounts.user.key() != Pubkey::from_str(DEV_WALLET_2).unwrap() {
            return Err(ErrorCode::Unauthorized.into());
        }

        let dev_account = &mut ctx.accounts.dev_account;

        let now = Clock::get()?.unix_timestamp;
        require!(now >= dev_account.cliff_time, ErrorCode::ClaimNotAvailableYet);

        let time_since_cliff = now.saturating_sub(dev_account.cliff_time);
        let total_vesting_duration = dev_account.vesting_end.saturating_sub(dev_account.cliff_time);

        let time_since_cliff_u64 = u64::try_from(time_since_cliff)
            .map_err(|_| ErrorCode::OperationOverflowed)?;
        let total_vesting_u64 = u64::try_from(total_vesting_duration)
            .map_err(|_| ErrorCode::OperationOverflowed)?;

        let vested_amount = if now >= dev_account.vesting_end {
            100_000_000
        } else {
            ((100_000_000u64)
                .checked_mul(time_since_cliff_u64)
                .ok_or(ErrorCode::OperationOverflowed)?
                .checked_div(total_vesting_u64)
                .ok_or(ErrorCode::OperationOverflowed)?) as u32
        };

        let claimable_amount = vested_amount.saturating_sub(dev_account.claimed);
        if claimable_amount == 0 {
            return Err(ErrorCode::NothingToClaim.into());
        }

        dev_account.claimed = dev_account.claimed + claimable_amount;

        let transfer_cpi_accounts = TransferChecked {
            from: ctx.accounts.dev_pool.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.curve_tokens_authority.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_2022_program.to_account_info();
        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"curve_tokens_authority",
                &[ctx.accounts.data_account.authority_bump],
            ],
        ];
        let cpi_context = CpiContext::new(cpi_program, transfer_cpi_accounts).with_signer(
            signer_seeds);
        let decimals = ctx.accounts.mint.decimals;
        let amount = u64::try_from(claimable_amount)
            .map_err(|_| ErrorCode::OperationOverflowed)?
            .checked_mul(10u64.pow(decimals as u32))
            .ok_or(ErrorCode::OperationOverflowed)?;
        token_interface::transfer_checked(cpi_context, amount, decimals)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCurveContext<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        space = 8 + DataAccount::INIT_SPACE,
        payer = signer,
        seeds = [b"data"],
        bump
    )]
    pub data_account: Account<'info, DataAccount>,

    /// CHECK: curve tokens authority
    #[account(
        mut,
        seeds = [b"curve_tokens_authority"],
        bump
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = signer,
        associated_token::mint = wsol_mint,
        associated_token::authority = curve_tokens_authority,
        associated_token::token_program = token_program,
     )]
    pub wsol_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    pub wsol_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = signer,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"dev_pool", dev_account_1.key().as_ref()],
        bump
    )]
    pub dev_pool_1: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = signer,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"dev_pool", dev_account_2.key().as_ref()],
        bump
    )]
    pub dev_pool_2: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = signer,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"giveaway_pool", data_account.key().as_ref()],
        bump
    )]
    pub giveaway_pool: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = signer,
        space = 8 + DevAccount::INIT_SPACE,
        seeds = [b"dev_account", Pubkey::from_str_const(DEV_WALLET_1).as_ref()],
        bump
    )]
    pub dev_account_1: Account<'info, DevAccount>,

     #[account(
        init,
        payer = signer,
        space = 8 + DevAccount::INIT_SPACE,
        seeds = [b"dev_account", Pubkey::from_str_const(DEV_WALLET_2).as_ref()],
        bump
    )]
    pub dev_account_2: Account<'info, DevAccount>,

    #[account(
        init,
        payer = signer,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"pool_token_treasury", data_account.key().as_ref()],
        bump
    )]
    pub pool_token_treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = signer,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"curve_token_treasury", data_account.key().as_ref()],
        bump
    )]
    pub curve_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_2022_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct BuyTokenContext<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"data"],
        bump = data_account.data_bump
    )]
    pub data_account : Account<'info, DataAccount>,

    /// CHECK: curve tokens mint authority
    #[account(
        seeds = [b"curve_tokens_authority"],
        bump = data_account.authority_bump,
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"user", signer.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        associated_token::mint = wsol_mint,
        associated_token::authority = curve_tokens_authority,
        associated_token::token_program = token_program,
    )]
    pub wsol_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        address = NATIVE_MINT,
    )]
    pub wsol_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct ClaimTokensContext<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"data"],
        bump = data_account.data_bump
    )]
    pub data_account : Account<'info, DataAccount>,

    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.user_bump,
        has_one = user
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: curve tokens mint authority
    #[account(
        seeds = [b"curve_tokens_authority"],
        bump = data_account.authority_bump,
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"curve_token_treasury", data_account.key().as_ref()],
        bump = data_account.curve_token_treasury_bump,
    )]
    pub curve_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPoolContext<'info> {
    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"data"],
        bump = data_account.data_bump
    )]
    pub data_account: Box<Account<'info, DataAccount>>,

    /// CHECK: curve tokens authority
    #[account(
        mut,
        seeds = [b"curve_tokens_authority"],
        bump = data_account.authority_bump,
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    /// Must match the hardcoded AMM_CONFIG_ADDRESS
    pub amm_config: Box<Account<'info, AmmConfig>>,

    /// CHECK: pool vault and lp mint authority
    #[account(
        seeds = [
            raydium_cp_swap::AUTH_SEED.as_bytes(),
        ],
        seeds::program = cp_swap_program,
        bump,
    )]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: Initialize an account to store the pool state
    #[account(
        mut,
        seeds = [
        POOL_SEED.as_bytes(),
        amm_config.key().as_ref(),
        token_0_mint.key().as_ref(),
        token_1_mint.key().as_ref(),
        ],
        seeds::program = cp_swap_program,
        bump,
    )]
    pub pool_state: UncheckedAccount<'info>,

    #[account(
        mint::token_program = token_0_program,
        address = NATIVE_MINT,
    )]
    pub token_0_mint: InterfaceAccount<'info, Mint>,

    #[account(
        address = data_account.mint.key(),
        constraint = token_0_mint.key() < token_1_mint.key(),
        mint::token_program = token_1_program,
    )]
    pub token_1_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: pool lp mint, init by cp-swap
    #[account(
        mut,
        seeds = [
            POOL_LP_MINT_SEED.as_bytes(),
            pool_state.key().as_ref(),
        ],
        seeds::program = cp_swap_program,
        bump,
    )]
    pub lp_mint: UncheckedAccount<'info>,

    // TODO: change this to wsol later
    #[account(
        mut,
        token::mint = token_0_mint,
        token::authority = curve_tokens_authority,
    )]
    pub creator_token_0: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_1_mint,
        token::authority = curve_tokens_authority,
        seeds = [b"pool_token_treasury", data_account.key().as_ref()],
        bump = data_account.pool_token_treasury_bump,
    )]
    pub creator_token_1: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_1_mint,
        token::authority = curve_tokens_authority,
        seeds = [b"curve_token_treasury", data_account.key().as_ref()],
        bump = data_account.curve_token_treasury_bump,
    )]
    pub curve_token_treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: creator lp ATA token account, init by cp-swap
    #[account(mut)]
    pub creator_lp_token: UncheckedAccount<'info>,

    /// CHECK: Token_0 vault for the pool, created by contract
    #[account(
        mut,
        seeds = [
            POOL_VAULT_SEED.as_bytes(),
            pool_state.key().as_ref(),
            token_0_mint.key().as_ref()
        ],
        seeds::program = cp_swap_program,
        bump,
    )]
    pub token_0_vault: UncheckedAccount<'info>,

    /// CHECK: Token_1 vault for the pool, created by contract
    #[account(
        mut,
        seeds = [
            POOL_VAULT_SEED.as_bytes(),
            pool_state.key().as_ref(),
            token_1_mint.key().as_ref()
        ],
        seeds::program = cp_swap_program,
        bump,
    )]
    pub token_1_vault: UncheckedAccount<'info>,

    /// create pool fee account
    #[account(
        mut,
        address= raydium_cp_swap::create_pool_fee_reveiver::ID,
    )]
    pub create_pool_fee: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: an account to store oracle observations, init by cp-swap
    #[account(
        mut,
        seeds = [
            OBSERVATION_SEED.as_bytes(),
            pool_state.key().as_ref(),
        ],
        seeds::program = cp_swap_program,
        bump,
    )]
    pub observation_state: UncheckedAccount<'info>,

    pub cp_swap_program: Program<'info, RaydiumCpSwap>,

    /// Program to create mint account and mint tokens
    pub token_program: Program<'info, Token>,
    /// Spl token program or token program 2022
    pub token_0_program: Interface<'info, TokenInterface>,
    /// Spl token program or token program 2022
    pub token_1_program: Interface<'info, TokenInterface>,
    /// Program to create an ATA for receiving position NFT
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// To create a new program account
    pub system_program: Program<'info, System>,
    /// Sysvar for program account
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BurnTokensContext<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"data"],
        bump = data_account.data_bump
    )]
    pub data_account: Box<Account<'info, DataAccount>>,

    /// CHECK: curve tokens account authority
    #[account(
        mut,
        seeds = [b"curve_tokens_authority"],
        bump = data_account.authority_bump,
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = curve_tokens_authority,
        associated_token::token_program = token_program,
    )]
    pub creator_lp_token: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"curve_token_treasury", data_account.key().as_ref()],
        bump = data_account.curve_token_treasury_bump,
    )]
    pub curve_token_treasury: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"pool_token_treasury", data_account.key().as_ref()],
        bump = data_account.pool_token_treasury_bump,
    )]
    pub pool_token_treasury: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_2022_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SendGiveawayContext<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"data"],
        bump = data_account.data_bump
    )]
    pub data_account: Account<'info, DataAccount>,

    /// CHECK: curve tokens account authority
    #[account(
        seeds = [b"curve_tokens_authority"],
        bump = data_account.authority_bump,
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"giveaway_pool", data_account.key().as_ref()],
        bump = data_account.giveaway_pool_bump,
    )]
    pub giveaway_pool: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: recipient of giveaway tokens
    pub recipient: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DevClaimContext<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"data"],
        bump = data_account.data_bump
    )]
    pub data_account: Account<'info, DataAccount>,

    /// CHECK: tokens authority
    #[account(
        mut,
        seeds = [b"curve_tokens_authority"],
        bump = data_account.authority_bump,
    )]
    pub curve_tokens_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"dev_account", user.key().as_ref()],
        bump = dev_account.dev_bump,
        has_one = user
    )]
    pub dev_account: Account<'info, DevAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = curve_tokens_authority,
        token::token_program = token_2022_program,
        seeds = [b"dev_pool", dev_account.key().as_ref()],
        bump = dev_account.dev_pool_bump,
    )]
    pub dev_pool: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_2022_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct DataAccount {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub sold: u32,
    pub deposited_sol: u64,
    pub price_dust: u128,
    pub start_time: i64, // start timestamp of the presale
    pub end_time: i64, // end of presale timestamp
    pub claim_end: i64, // end of claiming timestamp
    pub cliff_time: i64, // cliff timestamp
    pub pool_created: bool,
    pub data_bump: u8,
    pub authority_bump: u8,
    pub pool_token_treasury_bump: u8,
    pub curve_token_treasury_bump: u8,
    pub giveaway_pool_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    pub user: Pubkey,
    pub bought_tokens: u32,
    pub added_sol: u64,
    pub claimed: u32,
    pub user_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DevAccount {
    pub user: Pubkey,
    pub claimed: u32,
    pub cliff_time: i64,
    pub vesting_end: i64,
    pub dev_bump: u8,
    pub dev_pool_bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Claiming is not available yet.")] /// 6000
    ClaimNotAvailableYet,
    #[msg("There is nothing to claim.")] /// 6001
    NothingToClaim,
    #[msg("Max tokens to buy exceeded.")] /// 6002
    MaxTokensToBuyExceeded,
    #[msg("Tokens sold out.")] /// 6003
    TokensSoldOut,
    #[msg("Insufficient funds to buy tokens.")] /// 6004
    InsufficientFundsToBuyTokens,
    #[msg("Operation overflowed.")] /// 6005
    OperationOverflowed,
    #[msg("Need to buy at least one token.")] /// 6006
    NeedToBuyAtLeastOneToken,
    #[msg("Buy not available yet.")] /// 6007
    BuyNotAvailableYet,
    #[msg("Buy period has ended.")] /// 6008
    BuyPeriodEnded,
    #[msg("Presale not yet ended.")] /// 6009
    PresaleNotEnded,
    #[msg("Unauthorized.")] /// 6010
    Unauthorized,
    #[msg("Pool not created yet.")] /// 6011
    PoolNotCreated,
}