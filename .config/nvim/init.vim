set encoding=utf-8
let mapleader = ' '
set bs=eol,start,indent
set ic is scs sw=4 ts=4 et termguicolors hidden nu splitbelow splitright mouse=a diffopt+=vertical laststatus=0 cursorline
call plug#begin('~/.vim/bundle')
Plug 'scrooloose/nerdtree', { 'on': ['NERDTreeFind', 'NERDTreeToggle'] }
"{{{
"NERDTreefind
nnoremap <silent> ff :NERDTreeFind <Enter>
"NERDTree toggle
nnoremap <silent> <C-n> :NERDTreeToggle<CR>
"}}}
Plug 'gruvbox-community/gruvbox'
" Fading inactive window
" Plug 'TaDaa/vimade'
" "{{{
" " Support for tmux
" au! FocusLost * VimadeFadeActive
" au! FocusGained * VimadeUnfadeActive
" "}}}
Plug 'tpope/vim-surround'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-fugitive'
"fugitive vim
"{{{
nnoremap gw :Gwrite<Enter>
nnoremap gs :Gstatus<Enter>
nnoremap gc :Gcommit --gpg-sign -s <Enter>
nnoremap gp :Gpush
nnoremap gpf :Gpush --force
nnoremap gca :Gcommit -S --amend
nnoremap gpl :Gpull --rebase
" Commenting for fugitive commit session
" will take branch name as #Issue-number
let @w='5G$vByggIIssue #000 feat: <CR><CR><ESC>pggA'
let @e='ggIIssue #000 feat: '
let @r='ggIIssue #000 fix: '
"}}}
Plug 'junegunn/vim-easy-align'
"{{{
nmap ga <Plug>(EasyAlign)
xmap ga <Plug>(EasyAlign)
"}}}
Plug 'junegunn/gv.vim'
"{{{
nmap <silent> <leader>v :GV?<CR>
vmap <silent> <leader>v :GV?<CR>
"}}}
Plug 'tpope/vim-rhubarb'
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
"{{{
nnoremap <silent> <leader>p <nop>
"}}}
Plug 'junegunn/fzf.vim'
Plug 'vimwiki/vimwiki'
"{{{
" customization for wiki
let wiki_personal= {'path': '~/vimwiki_personal/', 'syntax': 'markdown', 'ext': '.md'}
let wiki_work = {'path': '~/vimwiki/', 'syntax': 'markdown', 'ext': '.md'}
let g:vimwiki_list = [wiki_work, wiki_personal]
let g:vimwiki_ext2syntax = {'.md': 'markdown',
                  \ '.mkd': 'markdown',
                  \ '.wiki': 'media'}
let g:vimwiki_folding='custom'
" map gc<Space> <Plug>VimwikiToggleListItem
"}}}

Plug 'iamcco/markdown-preview.nvim', { 'do': { -> mkdp#util#install() }, 'for': ['vimwiki', 'markdown', 'vim-plug']}

Plug 'andrewstuart/vim-kubernetes'
Plug 'wincent/ferret'
"{{{
let g:FerretJob=0
let g:FerretMaxResults=1000
" vnoremap /s "zy:Ack! -w --ignore *\.wiki --ignore *doc --ignore ekstep-devops <c-r>z<CR>
vnoremap <silent> /S "zy:Ack! -w <c-r>z<CR>
vnoremap <silent> /s "zy:Ack!  <c-r>z<CR>
"}}}
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'tpope/vim-unimpaired'
Plug 'tpope/vim-dispatch'
Plug 'radenling/vim-dispatch-neovim'
Plug 'scrooloose/nerdcommenter'
"{{{
" Add spaces after comment delimiters by default
let g:NERDSpaceDelims = 1

" Use compact syntax for prettified multi-line comments
let g:NERDCompactSexyComs = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'
" Allow commenting and inverting empty lines (useful when commenting a region)
let g:NERDCommentEmptyLines = 1
" Enable trimming of trailing whitespace when uncommenting
let g:NERDTrimTrailingWhitespace = 1
"}}}
Plug 'kien/rainbow_parentheses.vim'
"{{{
let g:rbpt_colorpairs = [
    \ ['brown',       'RoyalBlue3'],
    \ ['Darkblue',    'SeaGreen3'],
    \ ['darkgray',    'DarkOrchid3'],
    \ ['darkgreen',   'firebrick3'],
    \ ['darkcyan',    'RoyalBlue3'],
    \ ['darkred',     'SeaGreen3'],
    \ ['darkmagenta', 'DarkOrchid3'],
    \ ['brown',       'firebrick3'],
    \ ['gray',        'RoyalBlue3'],
    \ ['black',       'SeaGreen3'],
    \ ['darkmagenta', 'DarkOrchid3'],
    \ ['Darkblue',    'firebrick3'],
    \ ['darkgreen',   'RoyalBlue3'],
    \ ['darkcyan',    'SeaGreen3'],
    \ ['darkred',     'DarkOrchid3'],
    \ ['red',         'firebrick3'],
    \ ]
let g:rbpt_max = 16
let g:rbpt_loadcmd_toggle = 0
au VimEnter * RainbowParenthesesToggle
au Syntax * RainbowParenthesesLoadRound
au Syntax * RainbowParenthesesLoadSquare
au Syntax * RainbowParenthesesLoadBraces
"}}}
" Plug 'SirVer/ultisnips'
" "{{{
" " Trigger configuration. Do not use <tab> if you use https://github.com/Valloric/YouCompleteMe.
" let g:UltiSnipsExpandTrigger="<c-j>"
" let g:UltiSnipsJumpForwardTrigger="<c-j>"
" let g:UltiSnipsJumpBackwardTrigger="<c-k>"
" "}}}
Plug 'andrewstuart/vim-kubernetes'
Plug 'pearofducks/ansible-vim', { 'do': 'cd ./UltiSnips; ./generate.py --style dictionary' }
"{{{
let g:ansible_attribute_highlight = "ob"
let g:ansible_name_highlight = 'd'
let g:ansible_extra_keywords_highlight = 1
let g:ansible_normal_keywords_highlight = 'Constant'
"}}}
Plug 'michaeljsmith/vim-indent-object'
Plug 'mbbill/undotree'
Plug '907th/vim-auto-save'
let g:auto_save_events = ["CursorHold"]
set updatetime=600

Plug 'christoomey/vim-tmux-navigator'


Plug 'easymotion/vim-easymotion'
"{{{
" Easymotion plug
" Jump to anywhere you want with minimal keystrokes, with just one key binding.
" `s{char}{label}`
nmap <silent> , <Plug>(easymotion-overwin-f2)

" Replacing hjkl
" Gif config
map <silent> <Leader>j <Plug>(easymotion-j)
map <silent> <Leader>k <Plug>(easymotion-k)
let g:EasyMotion_startofline = 0 " keep cursor column when JK motion
"}}}

Plug 'fatih/vim-go'
Plug 'liuchengxu/vista.vim'

Plug 'vim-pandoc/vim-pandoc'

" Autocompletion engine
" Use release branch (recommend)
Plug 'neoclide/coc.nvim', {'branch': 'release'}

call plug#end()

" colorscheme solarized8_flat
colorscheme gruvbox
" colorscheme nord
set background=dark
let g:gruvbox_contrast_dark = 'medium'
let g:gruvbox_italicize_comments = 1



" Custom Undo
set undofile
if !has('nvim')
    set undodir=~/.vim/undo
endif

" Functions
" {{{
function! Term()
  exec winheight(0)/4."split" | set nonu | terminal
endfunction
if has('nvim')
     nnoremap <expr> <leader>T ":call TermTab()\<CR>"
endif

function! TermTab()
  tabnew | set nonu | terminal
endfunction

function! TrailClear()
    :%s/\s\+$//g
endfunction
command! TrailClear call TrailClear()
command! Date :r !date

function! DiffToggle(diff)
    "named argument diff
    if a:diff
        :windo diffoff
    else
        :windo diffthis
    endif
endfunction

function! SpaceEscape(...)
    return substitute(a:str," ","\ ","")
endfunction

function! PyRunner()
    :Dispatch! python %
endfunction
command! PyRunner call PyRunner()

function! DiffToggle(diff)
    "named argument diff
    if a:diff
        :windo diffoff
    else
        :windo diffthis
    endif
endfunction
nnoremap <silent> <leader>d :call DiffToggle(&diff)<CR>

" Ansible variable fix {{var}} to {{ var }}
function! AnsiVarFix()
    :%s/{{\s*\(.\{-}\)\s*}}/{{ \1 }}/g
    " :%s/{{\zs\s\+\(.\{-}\)\ze}}/{{ \2 }}/g
endfunction


let g:ansible_goto_role_paths = './roles,../_common/roles'

function! FindAnsibleRoleUnderCursor()
  if exists("g:ansible_goto_role_paths")
    let l:role_paths = g:ansible_goto_role_paths
  else
    let l:role_paths = "./roles"
  endif
  let l:tasks_main = expand("<cfile>") . "/tasks/main.yml"
  let l:found_role_path = findfile(l:tasks_main, l:role_paths)
  if l:found_role_path == ""
    echo l:tasks_main . " not found"
  else
    execute "edit " . fnameescape(l:found_role_path)
  endif
endfunction
"}}}

" Buffer Mappings
"{{{
augroup filetypes
    autocmd!
    " autocmd BufEnter,BufWritePre *.yml set foldmethod=indent foldlevel=10
    autocmd Filetype vim,python,sh setlocal foldmethod=marker shiftwidth=4 tabstop =4  expandtab
    autocmd Filetype yaml setlocal foldmethod=indent foldlevel=4 foldnestmax=2 shiftwidth=2 tabstop=2 expandtab | command! AnsiVarFix call AnsiVarFix()
    autocmd Filetype gitcommit setlocal spell completeopt-=preview
    autocmd Filetype git setlocal nofoldenable
    autocmd BufEnter,BufNewFile ".*\.md$" setlocal spell tabstop=2 expandtab shiftwidth=2 foldmethod=indent foldlevel=4 foldnestmax=2
    autocmd BufEnter,BufNewFile ".*\.go$" setlocal ft=go
    autocmd BufEnter Jenkinsfile setlocal ft=groovy
    autocmd FileType gitcommit,vimwiki let b:auto_save=1 | setlocal spell
    "custom file based remapings
    au FileType go nmap <leader>gr <Plug>(go-run)
    au FileType go nmap <leader>gt <Plug>(go-test)
    au FileType go nmap <silent><leader>gd :GoDecls<CR>
    " no save question if the content is coming from stdin
    au StdinReadPost * :set buftype=nofile
    au BufEnter,BufNewFile */ansible/*.y[a]\\\{0,1\}ml setlocal foldmethod=indent foldlevel=2 ft=yaml.ansible
    au BufEnter,BufNewFile */ansible/*.y[a]\\\{0,1\}ml nnoremap <silent> ]r :call FindAnsibleRoleUnderCursor()<CR>
    au BufEnter,BufNewFile ~/vimwiki/* lcd ~/vimwiki
    au FileType html,css EmmetInstall " | imap <M-c> @<Plug>(emmet-expand-abbr)

augroup END
"}}}

" Keyboard Mappings
" {{{
" Quit
nnoremap <leader>w :w<Enter>
nnoremap <leader>q :q<Enter>
nnoremap <leader>Q :qa<Enter>
nnoremap <leader>wq :wq<Enter>
nnoremap <leader>wQ :wqa!<Enter>

" Folding
" au BufNewFile,BufRead *.py,*.go set foldmethod=indent
vnoremap <silent> <space> :fold<CR>
nnoremap <silent> <space> za<CR>


" visual select
vnoremap // "zy/<C-R>z<CR>
vnoremap /b "zy:Back! <C-R>z<CR>
vnoremap /B "zy:Back! -w <C-R>z<CR>

" Copying to system clipboard
vnoremap Y "+y
nnoremap <C-p> :<C-u>Files<cr>

" Switch windows
nnoremap <c-j> <c-w>j
nnoremap <c-k> <c-w>k
nnoremap <c-h> <c-w>h
nnoremap <c-l> <c-w>l
if has('nvim')
    " Escape mode
    tnoremap <C-b><C-b> <C-\><C-n>
    " shell jumping
    tnoremap <c-h> <c-\><c-n><c-w>h
    tnoremap <c-j> <c-\><c-n><c-w>j
    tnoremap <c-k> <c-\><c-n><c-w>k
    tnoremap <c-l> <c-\><c-n><c-w>l
endif

"Undo map
nnoremap <silent> U :UndotreeToggle<CR>:UndotreeFocus<CR>

" Command mode history
cmap <M-h> <left>
cmap <M-l> <right>
cmap <M-k> <up>
cmap <M-j> <down>
" tabbing to complete popups
inoremap <silent><expr><tab> pumvisible() ? "\<c-n>" : "\<tab>"
inoremap <silent><expr><s-tab> pumvisible() ? "\<c-p>" : "\<s-tab>"

" search through buffers using fzf
nnoremap <silent><leader>b :Buffers<CR>
" search through files in current dir using fzf
nnoremap <silent><leader>f :Files<CR>
" search through history using fzf
nnoremap <silent><leader>h :History<CR>
"}}}



" Popup window for fzf
" Terminal buffer options for fzf
" {{{
autocmd! FileType fzf
autocmd  FileType fzf set noshowmode noruler nonu

if has('nvim') && exists('&winblend') && &termguicolors
  set winblend=20

  hi NormalFloat guibg=None
  if exists('g:fzf_colors.bg')
    call remove(g:fzf_colors, 'bg')
  endif

  if stridx($FZF_DEFAULT_OPTS, '--border') == -1
    let $FZF_DEFAULT_OPTS .= ' --border'
  endif

  function! FloatingFZF()
    let width = float2nr(&columns * 0.8)
    let height = float2nr(&lines * 0.6)
    let opts = { 'relative': 'editor',
               \ 'row': (&lines - height) / 2,
               \ 'col': (&columns - width) / 2,
               \ 'width': width,
               \ 'height': height }

    call nvim_open_win(nvim_create_buf(v:false, v:true), v:true, opts)
  endfunction

  let g:fzf_layout = { 'window': 'call FloatingFZF()' }
endif

" hack to commit the dotfiles
command! ConfigAdd !/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME add %
command! ConfigCommit !/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME commit -m "
command! ConfigPush !/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME push

command! -bang -nargs=? -complete=dir Files
        \ call fzf#vim#files(<q-args>, fzf#vim#with_preview({'options': ['--layout=reverse', '--info=inline']}), <bang>0)

"}}}

" COC-settings
"{{{
" Plugins
" TextEdit might fail if hidden is not set.
set hidden

" Some servers have issues with backup files, see #649.
set nobackup
set nowritebackup

" Give more space for displaying messages.
set cmdheight=2

" Having longer updatetime (default is 4000 ms = 4 s) leads to noticeable
" delays and poor user experience.
set updatetime=300

" Don't pass messages to |ins-completion-menu|.
set shortmess+=c

" Always show the signcolumn, otherwise it would shift the text each time
" diagnostics appear/become resolved.
if has("patch-8.1.1564")
  " Recently vim can merge signcolumn and number column into one
  set signcolumn=number
else
  set signcolumn=yes
endif

" Use tab for trigger completion with characters ahead and navigate.
" NOTE: Use command ':verbose imap <tab>' to make sure tab is not mapped by
" other plugin before putting this into your config.
inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" Use <c-space> to trigger completion.
inoremap <silent><expr> <c-space> coc#refresh()

" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current
" position. Coc only does snippet and additional edit on confirm.
" <cr> could be remapped by other vim plugin, try `:verbose imap <CR>`.
if exists('*complete_info')
  inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"
else
  inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
endif

" Use `[g` and `]g` to navigate diagnostics
" Use `:CocDiagnostics` to get all diagnostics of current buffer in location list.
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

" GoTo code navigation.
nmap <silent> gD <Plug>(coc-definition)
nmap <silent> gY <Plug>(coc-type-definition)
nmap <silent> gI <Plug>(coc-implementation)
nmap <silent> gR <Plug>(coc-references)

" Use K to show documentation in preview window.
nnoremap <silent> gK :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

" Highlight the symbol and its references when holding the cursor.
autocmd CursorHold * silent call CocActionAsync('highlight')

" Symbol renaming.
nmap <leader>rn <Plug>(coc-rename)

" Formatting selected code.
xmap <leader>F  <Plug>(coc-format-selected)
nmap <leader>F  <Plug>(coc-format-selected)

augroup mygroup
  autocmd!
  " Setup formatexpr specified filetype(s).
  autocmd FileType typescript,json setl formatexpr=CocAction('formatSelected')
  " Update signature help on jump placeholder.
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
augroup end

" Applying codeAction to the selected region.
" Example: `<leader>aap` for current paragraph
" xmap <leader>a  <Plug>(coc-codeaction-selected)
" nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap keys for applying codeAction to the current buffer.
" nmap <leader>ac  <Plug>(coc-codeaction)
" Apply AutoFix to problem on the current line.
" nmap <leader>qf  <Plug>(coc-fix-current)

" Map function and class text objects
" NOTE: Requires 'textDocument.documentSymbol' support from the language server.
xmap if <Plug>(coc-funcobj-i)
omap if <Plug>(coc-funcobj-i)
xmap af <Plug>(coc-funcobj-a)
omap af <Plug>(coc-funcobj-a)
xmap ic <Plug>(coc-classobj-i)
omap ic <Plug>(coc-classobj-i)
xmap ac <Plug>(coc-classobj-a)
omap ac <Plug>(coc-classobj-a)

" Use CTRL-S for selections ranges.
" Requires 'textDocument/selectionRange' support of LS, ex: coc-tsserver
nmap <silent> <C-s> <Plug>(coc-range-select)
xmap <silent> <C-s> <Plug>(coc-range-select)

" Add `:Format` command to format current buffer.
command! -nargs=0 Format :call CocAction('format')

" Add `:Fold` command to fold current buffer.
command! -nargs=? Fold :call     CocAction('fold', <f-args>)

" Add `:OR` command for organize imports of the current buffer.
command! -nargs=0 OR   :call     CocAction('runCommand', 'editor.action.organizeImport')

" Add (Neo)Vim's native statusline support.
" NOTE: Please see `:h coc-status` for integrations with external plugins that
" provide custom statusline: lightline.vim, vim-airline.
set statusline^=%{coc#status()}%{get(b:,'coc_current_function','')}

" Mappings for CoCList
" Show all diagnostics.
" nnoremap <silent><nowait> <space>a  :<C-u>CocList diagnostics<cr>
" " Manage extensions.
" nnoremap <silent><nowait> <space>e  :<C-u>CocList extensions<cr>
" " Show commands.
" nnoremap <silent><nowait> <space>c  :<C-u>CocList commands<cr>
" " Find symbol of current document.
" nnoremap <silent><nowait> <space>o  :<C-u>CocList outline<cr>
" " Search workspace symbols.
" nnoremap <silent><nowait> <space>s  :<C-u>CocList -I symbols<cr>
" " Do default action for next item.
" nnoremap <silent><nowait> <space>j  :<C-u>CocNext<CR>
" " Do default action for previous item.
" nnoremap <silent><nowait> <space>k  :<C-u>CocPrev<CR>
" " Resume latest coc list.
" nnoremap <silent><nowait> <space>p  :<C-u>CocListResume<CR>

" Plugin settings
" coc-go
autocmd BufWritePre *.go :call CocAction('runCommand', 'editor.action.organizeImport')

"}}}

set foldlevelstart=0
